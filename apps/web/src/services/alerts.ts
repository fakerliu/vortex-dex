import type {
  CheckAlertsResult,
  CreateAlertParams,
  PriceAlert,
  UpdateAlertParams,
} from "@/types/alerts";

/** 价格提醒服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isAlertsApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 价格提醒服务未接入（区别于普通网络/业务错误）。 */
export class AlertsNotAvailableError extends Error {
  constructor(message = "Price alerts service is not connected yet.") {
    super(message);
    this.name = "AlertsNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class AlertsApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AlertsApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const ALERTS_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid alert request.",
  VALIDATION_ERROR: "Invalid alert request.",
  NOT_FOUND: "Alert not found.",
  SERVICE_UNAVAILABLE: "Alerts service is temporarily unavailable.",
  INTERNAL_ERROR: "Alerts service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return ALERTS_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new AlertsNotAvailableError(
      "Price alerts service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** 解析响应信封：失败抛 AlertsApiError。 */
async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new AlertsApiError(
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
    throw new AlertsApiError(
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
      envelope.error?.message ?? `Alerts request failed (HTTP ${res.status}).`,
    );
    throw new AlertsApiError(code, message, res.status);
  }

  return envelope.data;
}

/** 统一请求封装（不要求 data 非空），用于 DELETE 等无返回体接口。 */
async function requestVoid(url: string, init: RequestInit): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new AlertsApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  const envelope = await parseEnvelope<void>(res);

  if (!res.ok || !envelope.success) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ?? `Alerts request failed (HTTP ${res.status}).`,
    );
    throw new AlertsApiError(code, message, res.status);
  }
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
  return request<T>(`${apiBaseOrThrow()}${path}${qs ? `?${qs}` : ""}`, {
    method: "GET",
  });
}

function jsonBody(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * 创建提醒：POST ${NEXT_PUBLIC_API_BASE_URL}/alerts。
 */
export async function createAlert(
  params: CreateAlertParams,
): Promise<PriceAlert> {
  return request<PriceAlert>(
    `${apiBaseOrThrow()}/alerts`,
    jsonBody({
      userAddress: params.userAddress,
      chainId: params.chainId,
      tokenAddress: params.tokenAddress,
      symbol: params.symbol,
      condition: params.condition,
      targetPrice: params.targetPrice,
      ...(params.notifyMethod !== undefined
        ? { notifyMethod: params.notifyMethod }
        : {}),
    }),
  );
}

/**
 * 列出某用户提醒：GET ${NEXT_PUBLIC_API_BASE_URL}/alerts?user=:address（created_at 降序）。
 */
export async function listAlerts(userAddress: string): Promise<PriceAlert[]> {
  return get<PriceAlert[]>("/alerts", { user: userAddress });
}

/**
 * 更新提醒：PATCH ${NEXT_PUBLIC_API_BASE_URL}/alerts/:id（部分字段）。
 */
export async function updateAlert(
  id: string,
  params: UpdateAlertParams,
): Promise<PriceAlert> {
  return request<PriceAlert>(`${apiBaseOrThrow()}/alerts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

/**
 * 删除提醒：DELETE ${NEXT_PUBLIC_API_BASE_URL}/alerts/:id。
 */
export async function deleteAlert(id: string): Promise<void> {
  return requestVoid(`${apiBaseOrThrow()}/alerts/${id}`, { method: "DELETE" });
}

/**
 * 手动触发一次惰性检查：POST ${NEXT_PUBLIC_API_BASE_URL}/alerts/check。
 * 按用户隔离，仅检查当前用户的 active 提醒。
 */
export async function checkAlerts(
  userAddress: string,
): Promise<CheckAlertsResult> {
  return request<CheckAlertsResult>(
    `${apiBaseOrThrow()}/alerts/check`,
    jsonBody({ userAddress }),
  );
}
