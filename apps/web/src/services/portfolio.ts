import type { PortfolioDto } from "@/types/portfolio";

/** 资产服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isPortfolioApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 资产服务未接入（区别于普通网络/业务错误）。 */
export class PortfolioNotAvailableError extends Error {
  constructor(message = "Portfolio service is not connected yet.") {
    super(message);
    this.name = "PortfolioNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class PortfolioApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PortfolioApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const PORTFOLIO_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid wallet address or request parameters.",
  VALIDATION_ERROR: "Invalid wallet address or request parameters.",
  NOT_FOUND: "No portfolio data is available for this wallet.",
  RPC_UNAVAILABLE: "Chain RPC is unreachable. Please try again.",
  SERVICE_UNAVAILABLE: "Portfolio service is temporarily unavailable.",
  INTERNAL_ERROR: "Portfolio service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return PORTFOLIO_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new PortfolioNotAvailableError(
      "Portfolio service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** GET 请求封装：拼 query 参数，解析统一信封，失败抛 PortfolioApiError。 */
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

  let res: Response;
  try {
    res = await fetch(`${apiBaseOrThrow()}${path}${qs ? `?${qs}` : ""}`, {
      method: "GET",
    });
  } catch (err) {
    throw new PortfolioApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new PortfolioApiError(
      "BAD_RESPONSE",
      `Endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || !envelope.success || !envelope.data) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ?? `Portfolio request failed (HTTP ${res.status}).`,
    );
    throw new PortfolioApiError(code, message, res.status);
  }

  return envelope.data;
}

/**
 * 用户资产组合。
 * GET ${NEXT_PUBLIC_API_BASE_URL}/users/:address/portfolio?chainId=。
 */
export async function fetchPortfolio(
  address: string,
  chainId: number,
): Promise<PortfolioDto> {
  return get<PortfolioDto>(`/users/${address}/portfolio`, { chainId });
}
