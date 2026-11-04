import type { Quote, QuoteParams } from "@/types/quote";

/** 后端报价引擎是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isQuoteApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 报价引擎未接入（区别于普通网络/业务错误）。 */
export class QuoteNotAvailableError extends Error {
  constructor(message = "Quote engine is not connected yet.") {
    super(message);
    this.name = "QuoteNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class QuoteApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "QuoteApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const QUOTE_ERROR_MESSAGES: Record<string, string> = {
  NO_ROUTE: "No available route for this pair.",
  QUOTE_EXPIRED: "This quote has expired. Please refresh.",
  RPC_UNAVAILABLE: "Chain RPC is unreachable. Please try again.",
  UNSUPPORTED_ROUTE: "Route is not supported yet.",
  BAD_REQUEST: "Invalid quote request.",
  VALIDATION_ERROR: "Invalid quote request.",
  SERVICE_UNAVAILABLE: "Quote engine is temporarily unavailable.",
  INTERNAL_ERROR: "Quote engine error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return QUOTE_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/**
 * 真正的报价请求：POST ${NEXT_PUBLIC_API_BASE_URL}/quote。
 *
 * - 请求体与后端 QuoteRequestDto 对齐：tokenIn / tokenOut / amountIn / chainId (+slippageBps)
 * - 解析统一信封 { success, data }，失败透传错误码并映射为可读文案
 * - 金额一律字符串，前端不做任何 Number() 化
 */
export async function fetchQuote(params: QuoteParams): Promise<Quote> {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new QuoteNotAvailableError(
      "Quote engine not connected. This is a placeholder — no fake quotes are returned.",
    );
  }

  const url = `${apiBase.replace(/\/+$/, "")}/quote`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        chainId: params.chainId,
        ...(params.slippageBps !== undefined
          ? { slippageBps: params.slippageBps }
          : {}),
      }),
    });
  } catch (err) {
    throw new QuoteApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let body: ApiEnvelope<Quote>;
  try {
    body = (await res.json()) as ApiEnvelope<Quote>;
  } catch {
    throw new QuoteApiError(
      "BAD_RESPONSE",
      `Quote endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || !body.success || !body.data) {
    const code = body.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      body.error?.message ?? `Quote request failed: ${res.status}`,
    );
    throw new QuoteApiError(code, message, res.status);
  }

  return body.data;
}
