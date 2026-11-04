import type {
  MarketPrice,
  MarketRankingResult,
  MarketRankingSortBy,
  MarketSnapshotResult,
  TokenDetail,
} from "@/types/market";

/** 市场数据服务是否已配置（未配置时 UI 显示「待接入」，不发请求）。 */
export function isMarketApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

/** 市场数据服务未接入（区别于普通网络/业务错误）。 */
export class MarketNotAvailableError extends Error {
  constructor(message = "Market data service is not connected yet.") {
    super(message);
    this.name = "MarketNotAvailableError";
  }
}

/** 后端返回的业务错误（统一信封 { success:false, error:{code,message} }）。 */
export class MarketApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MarketApiError";
    this.code = code;
    this.status = status;
  }
}

/** 后端错误码 -> 用户可读文案。 */
const MARKET_ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "Invalid request parameters.",
  VALIDATION_ERROR: "Invalid request parameters.",
  NOT_FOUND: "Token not found.",
  RPC_UNAVAILABLE: "Chain RPC is unreachable. Please try again.",
  SERVICE_UNAVAILABLE: "Market data service is temporarily unavailable.",
  INTERNAL_ERROR: "Market data service error. Please try again.",
};

function userMessage(code: string, fallback: string): string {
  return MARKET_ERROR_MESSAGES[code] ?? fallback;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function apiBaseOrThrow(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) {
    throw new MarketNotAvailableError(
      "Market data service not connected — no backend API is configured.",
    );
  }
  return apiBase.replace(/\/+$/, "");
}

/** GET 请求封装：拼 query 参数，解析统一信封，失败抛 MarketApiError。 */
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
    throw new MarketApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new MarketApiError(
      "BAD_RESPONSE",
      `Endpoint returned non-JSON response (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok || !envelope.success || !envelope.data) {
    const code = envelope.error?.code ?? "UNKNOWN_ERROR";
    const message = userMessage(
      code,
      envelope.error?.message ?? `Market data request failed (HTTP ${res.status}).`,
    );
    throw new MarketApiError(code, message, res.status);
  }

  return envelope.data;
}

/**
 * 市场快照（GET ${NEXT_PUBLIC_API_BASE_URL}/market/snapshot?chainId=）。
 * 每项含价格 + authenticity（后端已过滤 verified 目录 token）。
 */
export async function fetchMarketSnapshot(
  chainId: number,
): Promise<MarketSnapshotResult> {
  return get<MarketSnapshotResult>("/market/snapshot", { chainId });
}

/**
 * 代币榜单（Explore 数据源）。
 * GET ${NEXT_PUBLIC_API_BASE_URL}/market/ranking?chainId=&sortBy=&limit=。
 * 后端已按 sortBy 排好序并 join Token 表 + 聚合 Swap 成交量，
 * 每项含 priceUsd + volumeUsd 及其各自真实度标记。
 */
export async function fetchMarketRanking(
  chainId: number,
  sortBy?: MarketRankingSortBy,
  limit?: number,
): Promise<MarketRankingResult> {
  return get<MarketRankingResult>("/market/ranking", { chainId, sortBy, limit });
}

/**
 * 单 token 价格。
 * GET ${NEXT_PUBLIC_API_BASE_URL}/market/price?chainId=&token=。
 */
export async function fetchTokenPrice(
  chainId: number,
  address: string,
): Promise<MarketPrice> {
  return get<MarketPrice>("/market/price", { chainId, token: address });
}

/**
 * Token 元数据详情。
 * GET ${NEXT_PUBLIC_API_BASE_URL}/tokens/:address?chainId=。
 */
export async function fetchTokenDetail(
  chainId: number,
  address: string,
): Promise<TokenDetail> {
  return get<TokenDetail>(`/tokens/${address}`, { chainId });
}
