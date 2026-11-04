import type { TokenSecurityDto } from "@/types/security";

/** Security 服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isSecurityApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** Security 服务未接入（区别于普通网络/业务错误）。 */
export class SecurityNotAvailableError extends Error {
  constructor(message = "Security service is not connected yet.") {
    super(message);
    this.name = "SecurityNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class SecurityApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SecurityApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const SECURITY_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid token address or request parameters.",
  VALIDATION_ERROR: "Invalid token address or request parameters.",
  NOT_FOUND: "No security data is available for this token.",
  RPC_UNAVAILABLE: "Chain RPC is unreachable. Please try again.",
  SERVICE_UNAVAILABLE: "Security service is temporarily unavailable.",
  INTERNAL_ERROR: "Security service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return SECURITY_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new SecurityNotAvailableError(
      "Security service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** GET 请求封装：拼 query 参数，解析统一信封，失败抛 SecurityApiError。 */
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
    throw new SecurityApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new SecurityApiError(
      "BAD_RESPONSE",
      `Endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || !envelope.success || !envelope.data) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ?? `Security request failed (HTTP ${res.status}).`,
    );
    throw new SecurityApiError(code, message, res.status);
  }

  return envelope.data;
}

/**
 * Token 安全信息。
 * GET ${NEXT_PUBLIC_API_BASE_URL}/security/token/:address?chainId=。
 */
export async function fetchTokenSecurity(
  chainId: number,
  address: string,
): Promise<TokenSecurityDto> {
  return get<TokenSecurityDto>(`/security/token/${address}`, { chainId });
}
