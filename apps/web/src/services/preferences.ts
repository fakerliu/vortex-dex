import type {
  AddFavoriteParams,
  UpdatePreferenceParams,
  UserPreference,
} from "@/types/preferences";

/** 偏好服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isPreferencesApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 偏好服务未接入（区别于普通网络/业务错误）。 */
export class PreferencesNotAvailableError extends Error {
  constructor(message = "Preferences service is not connected yet.") {
    super(message);
    this.name = "PreferencesNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class PreferencesApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PreferencesApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const PREFERENCES_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid preferences request.",
  VALIDATION_ERROR: "Invalid preferences request.",
  NOT_FOUND: "Preferences not found.",
  SERVICE_UNAVAILABLE: "Preferences service is temporarily unavailable.",
  INTERNAL_ERROR: "Preferences service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return PREFERENCES_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new PreferencesNotAvailableError(
      "Preferences service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** 统一请求封装：发起 fetch，解析统一信封，失败抛 PreferencesApiError。 */
async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new PreferencesApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new PreferencesApiError(
      "BAD_RESPONSE",
      `Endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || !envelope.success || !envelope.data) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ??
        `Preferences request failed (HTTP ${res.status}).`,
    );
    throw new PreferencesApiError(code, message, res.status);
  }

  return envelope.data;
}

function jsonInit(method: string, body: Record<string, unknown>): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * 读取偏好：GET ${NEXT_PUBLIC_API_BASE_URL}/preferences/:address。
 * 无记录时后端返回默认值（不落库）。
 */
export async function getPreference(address: string): Promise<UserPreference> {
  return request<UserPreference>(
    `${apiBaseOrThrow()}/preferences/${address}`,
    { method: "GET" },
  );
}

/**
 * upsert 偏好：PUT ${NEXT_PUBLIC_API_BASE_URL}/preferences/:address（部分字段）。
 */
export async function updatePreference(
  address: string,
  params: UpdatePreferenceParams,
): Promise<UserPreference> {
  return request<UserPreference>(
    `${apiBaseOrThrow()}/preferences/${address}`,
    jsonInit("PUT", { ...params }),
  );
}

/**
 * 加收藏：POST ${NEXT_PUBLIC_API_BASE_URL}/preferences/:address/favorites（去重）。
 */
export async function addFavorite(
  address: string,
  params: AddFavoriteParams,
): Promise<UserPreference> {
  return request<UserPreference>(
    `${apiBaseOrThrow()}/preferences/${address}/favorites`,
    jsonInit("POST", {
      chainId: params.chainId,
      address: params.address,
      symbol: params.symbol,
    }),
  );
}

/**
 * 移除收藏：DELETE ${NEXT_PUBLIC_API_BASE_URL}/preferences/:address/favorites/:tokenAddress。
 */
export async function removeFavorite(
  address: string,
  tokenAddress: string,
): Promise<UserPreference> {
  return request<UserPreference>(
    `${apiBaseOrThrow()}/preferences/${address}/favorites/${tokenAddress}`,
    { method: "DELETE" },
  );
}
