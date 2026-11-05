import type {
  CreateLimitOrderParams,
  CreateLimitOrderResult,
  LimitOrderDto,
  LimitOrderListParams,
  LimitOrderListResult,
  SubmitSignatureParams,
} from "@/types/limit-order";

/** 限价单服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isLimitOrderApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 限价单服务未接入（区别于普通网络/业务错误）。 */
export class LimitOrderNotAvailableError extends Error {
  constructor(message = "Limit order service is not connected yet.") {
    super(message);
    this.name = "LimitOrderNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class LimitOrderApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "LimitOrderApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const LIMIT_ORDER_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid limit order request.",
  VALIDATION_ERROR: "Invalid limit order request.",
  NOT_FOUND: "Limit order not found.",
  CONFLICT: "This limit order was already armed or cannot be updated.",
  FORBIDDEN: "You are not allowed to update this order.",
  RPC_UNAVAILABLE: "Chain RPC is unreachable. Please try again.",
  SERVICE_UNAVAILABLE: "Limit order service is temporarily unavailable.",
  INTERNAL_ERROR: "Limit order service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return LIMIT_ORDER_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new LimitOrderNotAvailableError(
      "Limit order service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new LimitOrderApiError(
      "BAD_RESPONSE",
      `Endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }
}

/** 统一请求封装（要求 data 非空），返回 data。 */
async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new LimitOrderApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  const envelope = await parseEnvelope<T>(res);

  if (!res.ok || !envelope.success || !envelope.data) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ??
        `Limit order request failed (HTTP ${res.status}).`,
    );
    throw new LimitOrderApiError(code, message, res.status);
  }

  return envelope.data;
}

async function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const search = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
  }
  const qs = search.toString();
  return request<T>(
    `${apiBaseOrThrow()}${path}${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
}

function postJson(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * 下单：POST ${NEXT_PUBLIC_API_BASE_URL}/limit-orders。
 * 返回 order + signingPayload（待签交易清单，先 approval 后 swap）。
 */
export async function createLimitOrder(
  params: CreateLimitOrderParams,
): Promise<CreateLimitOrderResult> {
  return request<CreateLimitOrderResult>(
    `${apiBaseOrThrow()}/limit-orders`,
    postJson({
      userAddress: params.userAddress,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      limitPrice: params.limitPrice,
      ...(params.chainId !== undefined ? { chainId: params.chainId } : {}),
      ...(params.direction !== undefined
        ? { direction: params.direction }
        : {}),
      ...(params.slippageBps !== undefined
        ? { slippageBps: params.slippageBps }
        : {}),
      ...(params.expiresAt !== undefined
        ? { expiresAt: params.expiresAt }
        : {}),
    }),
  );
}

/**
 * 提交签名：POST ${NEXT_PUBLIC_API_BASE_URL}/limit-orders/:id/signature。
 * 后端校验 recover 地址 + calldata 后武装订单（armed）。
 */
export async function submitLimitOrderSignature(
  id: string,
  params: SubmitSignatureParams,
): Promise<LimitOrderDto> {
  return request<LimitOrderDto>(
    `${apiBaseOrThrow()}/limit-orders/${id}/signature`,
    postJson({
      userAddress: params.userAddress,
      ...(params.signedApprovalTx
        ? { signedApprovalTx: params.signedApprovalTx }
        : {}),
      signedSwapTx: params.signedSwapTx,
    }),
  );
}

/**
 * 列表：GET ${NEXT_PUBLIC_API_BASE_URL}/limit-orders?user=&status=&page=&limit=。
 */
export async function listLimitOrders(
  userAddress: string,
  params: LimitOrderListParams = {},
): Promise<LimitOrderListResult> {
  return get<LimitOrderListResult>("/limit-orders", {
    user: userAddress,
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.page !== undefined ? { page: params.page } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  });
}

/**
 * 详情：GET ${NEXT_PUBLIC_API_BASE_URL}/limit-orders/:id。
 */
export async function getLimitOrder(id: string): Promise<LimitOrderDto> {
  return request<LimitOrderDto>(
    `${apiBaseOrThrow()}/limit-orders/${id}`,
    { method: "GET" },
  );
}

/**
 * 撤单：POST ${NEXT_PUBLIC_API_BASE_URL}/limit-orders/:id/cancel（CAS + 属主校验）。
 */
export async function cancelLimitOrder(
  id: string,
  userAddress: string,
): Promise<LimitOrderDto> {
  return request<LimitOrderDto>(
    `${apiBaseOrThrow()}/limit-orders/${id}/cancel`,
    postJson({ userAddress }),
  );
}
