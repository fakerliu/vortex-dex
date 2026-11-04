import type { PoolDetail, PoolListResult } from "@/types/pool";

/** 池数据服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isPoolApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 池数据服务未接入（区别于普通网络/业务错误）。 */
export class PoolNotAvailableError extends Error {
  constructor(message = "Pool explorer service is not connected yet.") {
    super(message);
    this.name = "PoolNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class PoolApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PoolApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const POOL_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid request parameters.",
  VALIDATION_ERROR: "Invalid request parameters.",
  NOT_FOUND: "Pool not found.",
  SERVICE_UNAVAILABLE: "Pool explorer service is temporarily unavailable.",
  INTERNAL_ERROR: "Pool explorer service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return POOL_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new PoolNotAvailableError(
      "Pool explorer service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** GET 请求封装：拼 query 参数，解析统一信封，失败抛 PoolApiError。 */
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
    throw new PoolApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new PoolApiError(
      "BAD_RESPONSE",
      `Endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || !envelope.success || !envelope.data) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ?? `Pool request failed (HTTP ${res.status}).`,
    );
    throw new PoolApiError(code, message, res.status);
  }

  return envelope.data;
}

/**
 * 池列表。
 * GET ${NEXT_PUBLIC_API_BASE_URL}/pools?chainId=&token0=&token1=&page=&limit=。
 */
export async function fetchPools(
  chainId: number,
  page = 1,
  limit = 20,
): Promise<PoolListResult> {
  return get<PoolListResult>("/pools", { chainId, page, limit });
}

/**
 * 池详情（含历史快照）。
 * GET ${NEXT_PUBLIC_API_BASE_URL}/pools/:id。
 */
export async function fetchPoolDetail(id: string): Promise<PoolDetail> {
  return get<PoolDetail>(`/pools/${id}`);
}
