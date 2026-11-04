import type { Authenticity } from "@/types/market";

/**
 * Pool 流动性池相关类型（与后端契约严格对齐，Sprint 6 Pool Explorer）。
 *
 * 数据真实度标记 `authenticity` 复用市场模块的 Authenticity 枚举（后端
 * apps/api/src/common/constants/data-authenticity.ts）。池数据由链上池子
 * 发现落库，故恒为 REAL_ONCHAIN。
 *
 * 金额铁律：fee 为 ppm 字符串（1_000_000 = 100%），liquidity / reserve0 /
 * reserve1 均为「链上原始大整数字符串」，禁 Float。
 */

/** 池子里的单个 token 引用。 */
export interface PoolTokenRef {
  /** 小写规范化地址。 */
  address: string;
  symbol: string | null;
  decimals: number | null;
}

/**
 * 池列表项（GET /api/v1/pools 的 items[]）。
 * 后端已 join dex_protocols + Token 表。
 */
export interface PoolListItem {
  id: string;
  chainId: number;
  /** 小写规范化地址。 */
  poolAddress: string;
  /** aerodrome_classic / aerodrome_cl / uniswap_v3 等。 */
  protocolType: string;
  protocolName: string;
  token0: PoolTokenRef;
  token1: PoolTokenRef;
  /** ppm 字符串，如 "3000" = 0.30%。 */
  fee: string;
  /** 原始大整数字符串。 */
  liquidity: string;
  reserve0: string;
  reserve1: string;
  lastSyncedBlock: number;
  authenticity: Authenticity;
}

/** 池列表结果（GET /api/v1/pools）。 */
export interface PoolListResult {
  items: PoolListItem[];
  page: number;
  limit: number;
  total: number;
}

/** 池子历史快照。 */
export interface PoolSnapshot {
  blockNumber: number;
  reserve0: string;
  reserve1: string;
  liquidity: string;
  /** ISO 字符串。 */
  createdAt: string;
}

/** 池详情（GET /api/v1/pools/:id），列表项 + 历史快照。 */
export interface PoolDetail extends PoolListItem {
  snapshots: PoolSnapshot[];
}
