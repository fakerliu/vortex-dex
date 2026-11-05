import type { DataAuthenticity } from '../../common/constants/data-authenticity';

/**
 * 单 token 市场价对外 DTO（camelCase）。
 *
 * 精度铁律：priceUsd / liquidityUsd 一律为「十进制字符串」（如 "2000.5"），
 * 由 BigInt 定点运算推导，绝不使用 Float。
 *
 * authenticity 严格取值自 DataAuthenticity 枚举，声明该价格的真实程度：
 * - REAL_ONCHAIN：由链上池子报价直接推导（token→USDC 或 token→WETH→USDC）
 * - UNAVAILABLE：链上无池 / RPC 不可达，无法给出真实价格（priceUsd=null）
 */
export interface MarketPriceDto {
  chainId: number;
  tokenAddress: string; // 小写规范化
  priceUsd: string | null; // 链上推导的 USD 价格（十进制字符串）
  quoteToken: string | null; // 价格基准 token 地址（小写），如 USDC / WETH
  authenticity: DataAuthenticity;
  source: string | null; // 数据来源描述，如 "onchain-quote-via-usdc"
  blockNumber: number | null;
}

/**
 * 市场快照列表项 DTO（MarketPriceDto + token 元信息 + 落库时间）。
 * 与 MarketSnapshot 表一一对应，供 Explore / Token Detail 消费。
 */
export interface MarketSnapshotDto extends MarketPriceDto {
  symbol: string | null;
  decimals: number | null;
  liquidityUsd: string | null; // 估算 USD 流动性（可选，当前未计算则 null）
  updatedAt: string; // 落库时间 ISO 字符串
}

/**
 * GET /api/v1/market/snapshot 的响应结构。
 * 每个字段均带 authenticity（位于 items[] 每一项内）。
 */
export interface MarketSnapshotResult {
  chainId: number;
  blockNumber: number | null;
  items: MarketSnapshotDto[];
}

/**
 * 榜单排序方式（Explore 代币榜单）。
 *
 * - 不传（默认）：按 priceUsd 降序（价格榜单）
 * - volume：按 volumeUsd 降序（成交量榜单）
 * - price_change：按 priceChange 降序（涨跌幅榜单，基于历史快照）
 */
export type RankingSortBy = 'volume' | 'price_change';

/**
 * 榜单单项（Explore 代币榜单）。
 *
 * authenticity 语义：价格与成交量是两个独立数据源，真实度分别标注：
 * - `authenticity`：priceUsd 的真实度，直接取 market_snapshots 落库值
 *   （REAL_ONCHAIN 或 UNAVAILABLE）。
 * - `volumeAuthenticity`：volumeUsd 的真实度，成交量是内部从 Swap 表聚合
 *   估算而来（INTERNAL_CALCULATED）；无价格/聚合失败时为 UNAVAILABLE。
 */
export interface RankingItem {
  chainId: number;
  address: string; // 小写规范化
  symbol: string | null;
  name: string | null;
  logoURI: string | null;
  verified: boolean;
  risk: boolean;
  priceUsd: string | null; // 十进制字符串，来自 market_snapshots
  priceChange: string | null; // 涨跌幅（十进制字符串，可正可负），缺历史快照为 null
  quoteToken: string | null; // 价格基准 token 地址（小写）
  volumeUsd: string | null; // 十进制字符串，内部从 Swap 聚合估算的 USD 成交量
  authenticity: DataAuthenticity; // priceUsd 的真实度
  volumeAuthenticity: DataAuthenticity; // volumeUsd 的真实度
  source: string | null;
  blockNumber: number | null;
}

/**
 * GET /api/v1/market/ranking 的响应结构。
 * `sortBy` 为实际生效的排序方式。
 */
export interface RankingResult {
  chainId: number;
  sortBy: 'price' | 'volume' | 'price_change';
  limit: number;
  items: RankingItem[];
}
