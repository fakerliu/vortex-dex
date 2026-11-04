"use client";

/**
 * 前端埋点（Analytics 第三步）。
 *
 * 职责：
 * - 生成并持久化 session_id（一次会话一个）。
 * - 生成 intent_id（一次交易意图一个，贯穿 前端行为→报价→路由→交易）。
 * - fire-and-forget 上报事件到后端 /api/v1/analytics/events。
 *
 * 铁律：
 * - 埋点失败绝不影响主流程（不抛错、不 await 阻塞）。
 * - 不采集私钥 / 助记词 / 签名原文。
 */

const SESSION_KEY = "vortex_session_id";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟会话

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 获取或创建会话 ID（localStorage 持久化，30 分钟过期）。 */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; ts: number };
      if (Date.now() - parsed.ts < SESSION_TTL_MS) {
        return parsed.id;
      }
    }
    const id = genId();
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ id, ts: Date.now() }),
    );
    return id;
  } catch {
    return "";
  }
}

/** 生成一次交易意图 ID。 */
export function createIntentId(): string {
  return genId();
}

/** 事件上报（fire-and-forget，失败静默）。 */
export function trackEvent(input: {
  eventName: string;
  intentId?: string;
  walletAddress?: string;
  chainId?: number;
  properties?: Record<string, unknown>;
}): void {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) return;

  try {
    const payload = {
      eventName: input.eventName,
      intentId: input.intentId,
      walletAddress: input.walletAddress,
      chainId: input.chainId,
      sessionId: getSessionId(),
      properties: input.properties ?? {},
    };

    // 用 sendBeacon 或 fetch 发送，均不阻塞主流程
    void fetch(`${apiBase.replace(/\/+$/, "")}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* 埋点失败静默 */
    });
  } catch {
    /* 埋点失败静默 */
  }
}
