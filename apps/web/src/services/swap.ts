import type {
  PrepareSwapParams,
  PrepareSwapResult,
  SubmitSwapParams,
  SwapRecord,
} from "@/types/swap";

/** 执行引擎是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isSwapApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 执行引擎未接入（区别于普通网络/业务错误）。 */
export class SwapNotAvailableError extends Error {
  constructor(message = "Swap execution engine is not connected yet.") {
    super(message);
    this.name = "SwapNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class SwapApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SwapApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const SWAP_ERROR_MESSAGES: Record<string, string> = {
  NO_ROUTE: "No available route for this pair.",
  RPC_UNAVAILABLE: "Chain RPC is unreachable. Please try again.",
  UNSUPPORTED_ROUTE: "Route is not supported yet.",
  BAD_REQUEST: "Invalid swap request.",
  VALIDATION_ERROR: "Invalid swap request.",
  SERVICE_UNAVAILABLE: "Execution engine is temporarily unavailable.",
  INTERNAL_ERROR: "Execution engine error. Please try again.",
  CONFLICT: "This transaction was already submitted.",
};

function userMessage(code: string, fallback: string): string {
  return SWAP_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new SwapNotAvailableError(
      "Swap execution engine not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** 统一请求封装：POST JSON，解析统一信封，失败抛 SwapApiError。 */
async function post<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${apiBaseOrThrow()}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new SwapApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new SwapApiError(
      "BAD_RESPONSE",
      `Endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || !envelope.success || !envelope.data) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ?? `Swap request failed: ${res.status}`,
    );
    throw new SwapApiError(code, message, res.status);
  }

  return envelope.data;
}

/**
 * 准备交易：POST ${NEXT_PUBLIC_API_BASE_URL}/swaps/prepare。
 * 返回已编码好的 swap + approve calldata，前端直接签名广播。
 */
export async function prepareSwap(
  params: PrepareSwapParams,
): Promise<PrepareSwapResult> {
  return post<PrepareSwapResult>("/swaps/prepare", {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    userAddress: params.userAddress,
    ...(params.slippageBps !== undefined
      ? { slippageBps: params.slippageBps }
      : {}),
    ...(params.chainId !== undefined ? { chainId: params.chainId } : {}),
  });
}

/**
 * 回写已广播交易：POST ${NEXT_PUBLIC_API_BASE_URL}/swaps/submit。
 * 只收公开 tx_hash（非托管）。
 */
export async function submitSwap(
  params: SubmitSwapParams,
): Promise<SwapRecord> {
  return post<SwapRecord>("/swaps/submit", {
    txHash: params.txHash,
    userAddress: params.userAddress,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    amountOut: params.amountOut,
    ...(params.chainId !== undefined ? { chainId: params.chainId } : {}),
    ...(params.status !== undefined ? { status: params.status } : {}),
  });
}
