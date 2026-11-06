/**
 * 市场数据相关类型（与后端契约严格对齐，Sprint 3）。
 *
 * 数据真实度标记 `authenticity` 严格取自后端 DataAuthenticity 枚举
 * （apps/api/src/common/constants/data-authenticity.ts，参考 docs/data-authenticity.md）。
 * 金额（priceUsd / liquidityUsd）一律为「十进制字符串」，禁 Float。
 */

/** 数据真实度标记（6 个取值之一，勿用其他字符串）。 */
export type Authenticity =
  | "REAL_ONCHAIN"
  | "REAL_PROVIDER"
  | "INTERNAL_CALCULATED"
  | "MOCK"
  | "UNAVAILABLE"
  | "STALE";

/**
 * 单 token 市场价（GET /api/v1/market/price?chainId=&token=）。
 * 链上无池 / RPC 不可达时后端优雅降级为 authenticity=UNAVAILABLE（priceUsd=null）。
 */
export interface MarketPrice {
  chainId: number;
  /** 小写规范化地址。 */
  tokenAddress: string;
  /** 链上推导的 USD 价格（十进制字符串），不可用时为 null。 */
  priceUsd: string | null;
  /** 价格基准 token 地址（小写），如 USDC / WETH。 */
  quoteToken: string | null;
  authenticity: Authenticity;
  /** 数据来源描述，如 "onchain-quote-via-usdc"。 */
  source: string | null;
  blockNumber: number | null;
}

/**
 * 市场快照列表项（MarketPrice + token 元信息）。
 * 对应 GET /api/v1/market/snapshot 的 items[]。
 */
export interface MarketSnapshotItem extends MarketPrice {
  symbol: string | null;
  decimals: number | null;
  liquidityUsd: string | null;
  /** 落库时间 ISO 字符串。 */
  updatedAt: string;
}

/** 市场快照结果（GET /api/v1/market/snapshot?chainId=）。 */
export interface MarketSnapshotResult {
  chainId: number;
  blockNumber: number | null;
  items: MarketSnapshotItem[];
}

/**
 * 榜单排序方式（GET /api/v1/market/ranking 的 sortBy 参数，以及响应中的实际 sortBy）。
 * - price：按 priceUsd 降序（价格榜单，后端默认，未传 sortBy 即 price）
 * - volume：按 volumeUsd 降序（成交量榜单）
 * - price_change：按 priceChange 降序（涨跌幅榜单，基于历史快照）
 *
 * 注意：后端 controller 只接受 volume / price_change 作为查询参数，price 为默认值
 * （传 sortBy=price 会触发 400）。前端选中 price 时由 hook 归一化为「不传 sortBy」。
 */
export type MarketRankingSortBy = "price" | "volume" | "price_change";

/**
 * 榜单单项（GET /api/v1/market/ranking 的 items[]）。
 * 后端已 join Token 表 + 聚合 Swap 成交量，含 name/logoURI/verified/risk 全量字段。
 * 价格与成交量是两个独立数据源，真实度分别标注：
 * - `authenticity`：priceUsd 真实度（REAL_ONCHAIN 或 UNAVAILABLE）
 * - `volumeAuthenticity`：volumeUsd 真实度（INTERNAL_CALCULATED 或 UNAVAILABLE）
 */
export interface MarketRankingItem {
  chainId: number;
  /** 小写规范化地址。 */
  address: string;
  symbol: string | null;
  name: string | null;
  logoURI: string | null;
  verified: boolean;
  risk: boolean;
  /** 十进制字符串，来自 market_snapshots。 */
  priceUsd: string | null;
  /** 涨跌幅（十进制字符串，可正可负），缺历史快照时为 null。 */
  priceChange: string | null;
  /** 价格基准 token 地址（小写）。 */
  quoteToken: string | null;
  /** 24h 成交量（USD 十进制字符串），内部从 Swap 表聚合估算。 */
  volumeUsd: string | null;
  /** priceUsd 的真实度。 */
  authenticity: Authenticity;
  /** volumeUsd 的真实度。 */
  volumeAuthenticity: Authenticity;
  source: string | null;
  blockNumber: number | null;
}

/** 榜单结果（GET /api/v1/market/ranking）。sortBy 为实际生效的排序方式。 */
export interface MarketRankingResult {
  chainId: number;
  sortBy: MarketRankingSortBy;
  limit: number;
  /** 匹配条件的代币总数（用于分页，后端新增，含未落在当前页的币）。 */
  total: number;
  items: MarketRankingItem[];
}

/**
 * Token 元数据详情（GET /api/v1/tokens/:address?chainId=）。
 * 与后端 TokenDto 对齐（前端本地 config/tokens 的 Token 超集）。
 */
export interface TokenDetail {
  chainId: number;
  /** 小写规范化地址。 */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  verified: boolean;
  risk: boolean;
  source: string | null;
}
