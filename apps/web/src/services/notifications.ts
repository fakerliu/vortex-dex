import type { Notification, UnreadCount } from "@/types/notifications";

/** 通知服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isNotificationsApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 通知服务未接入（区别于普通网络/业务错误）。 */
export class NotificationsNotAvailableError extends Error {
  constructor(message = "Notifications service is not connected yet.") {
    super(message);
    this.name = "NotificationsNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class NotificationsApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "NotificationsApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const NOTIFICATIONS_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid notifications request.",
  VALIDATION_ERROR: "Invalid notifications request.",
  NOT_FOUND: "Notification not found.",
  SERVICE_UNAVAILABLE: "Notifications service is temporarily unavailable.",
  INTERNAL_ERROR: "Notifications service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return NOTIFICATIONS_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new NotificationsNotAvailableError(
      "Notifications service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** 解析响应信封：失败抛 NotificationsApiError。 */
async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new NotificationsApiError(
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
    throw new NotificationsApiError(
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
        `Notifications request failed (HTTP ${res.status}).`,
    );
    throw new NotificationsApiError(code, message, res.status);
  }

  return envelope.data;
}

/** 统一请求封装（不要求 data 非空），用于 PATCH/POST 标记已读等无返回体接口。 */
async function requestVoid(url: string, init: RequestInit): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new NotificationsApiError(
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
      envelope.error?.message ??
        `Notifications request failed (HTTP ${res.status}).`,
    );
    throw new NotificationsApiError(code, message, res.status);
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
 * 列出某用户通知：GET ${NEXT_PUBLIC_API_BASE_URL}/notifications?user=:address
 * （未读优先 + created_at 降序）。
 */
export async function listNotifications(
  userAddress: string,
): Promise<Notification[]> {
  return get<Notification[]>("/notifications", { user: userAddress });
}

/**
 * 标记单条已读：PATCH ${NEXT_PUBLIC_API_BASE_URL}/notifications/:id/read。
 */
export async function markRead(id: string): Promise<void> {
  return requestVoid(`${apiBaseOrThrow()}/notifications/${id}/read`, {
    method: "PATCH",
  });
}

/**
 * 全部已读：POST ${NEXT_PUBLIC_API_BASE_URL}/notifications/read-all。
 */
export async function markAllRead(userAddress: string): Promise<void> {
  return requestVoid(
    `${apiBaseOrThrow()}/notifications/read-all`,
    jsonBody({ userAddress }),
  );
}

/**
 * 未读数：GET ${NEXT_PUBLIC_API_BASE_URL}/notifications/unread-count?user=:address。
 */
export async function unreadCount(
  userAddress: string,
): Promise<UnreadCount> {
  return get<UnreadCount>("/notifications/unread-count", { user: userAddress });
}
