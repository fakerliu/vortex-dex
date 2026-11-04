import type { Quote, QuoteParams } from "@/types/quote";

/** 后端报价引擎是否已配置（默认未配置，UI 显示「待接入」） */
export function isQuoteApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

export class QuoteNotAvailableError extends Error {
  constructor(message = "Quote engine is not connected yet.") {
    super(message);
    this.name = "QuoteNotAvailableError";
  }
}

/**
 * 报价服务接口占位。
 *
 * 后端契约（backend-engineer，Sprint 1 骨架）：
 * - 统一前缀 /api/v1，端口 3001（env API_PORT）
 * - 成功响应：{ success: true, data: <Quote> }
 * - 错误响应：{ success: false, error: { code, message }, path, timestamp }
 * - 金额字段一律为字符串（链上精度），前端禁止 Number() 化
 *
 * 本函数不会返回假数字。当 NEXT_PUBLIC_API_BASE_URL 未配置时，
 * 直接抛出 QuoteNotAvailableError，由 UI 展示「报价引擎待接入」。
 */
export async function fetchQuote(_params: QuoteParams): Promise<Quote> {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new QuoteNotAvailableError(
      "Quote engine not connected. This is a placeholder — no fake quotes are returned.",
    );
  }

  // TODO(phase-2): 接入后端 POST /api/v1/quote，并按统一信封解析
  // const res = await fetch(`${apiBase}/quote`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(_params),
  // });
  // const body = await res.json();
  // if (!res.ok || !body?.success) {
  //   throw new QuoteNotAvailableError(
  //     body?.error?.message ?? `Quote request failed: ${res.status}`,
  //   );
  // }
  // return body.data as Quote;

  throw new QuoteNotAvailableError(
    "Quote engine endpoint configured but not yet implemented.",
  );
}
