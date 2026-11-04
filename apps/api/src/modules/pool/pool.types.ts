import type { DataAuthenticity } from '../../common/constants/data-authenticity';

/**
 * Pool 流动性池模块对外 DTO（camelCase，与前端 apps/web/src/types/pool.ts 对齐）。
 *
 * 精度铁律：
 * - fee 为 ppm 字符串（1_000_000 = 100%），如 "3000" 表示 0.30%。
 * - liquidity / reserve0 / reserve1 均为「链上原始大整数字符串」，绝不使用 Float。
 *
 * authenticity 恒为 REAL_ONCHAIN：pools 表数据由报价/路由引擎触发的链上
 * 池子发现 + getReserves/liquidity 等合约读取落库，属直接链上数据。
 */

/** 池子里的单个 token 引用（join Token 表拿到的元数据，可能缺失）。 */
export interface PoolTokenRef {
  address: string; // 小写规范化
  symbol: string | null;
  decimals: number | null;
}

/**
 * GET /api/v1/pools 列表项。
 * join dex_protocols（protocol_type / name）+ Token 表（token0/token1 元数据）。
 */
export interface PoolListItemDto {
  id: string;
  chainId: number;
  poolAddress: string; // 小写规范化
  protocolType: string; // aerodrome_classic / aerodrome_cl / uniswap_v3 等
  protocolName: string;
  token0: PoolTokenRef;
  token1: PoolTokenRef;
  fee: string; // ppm 字符串
  liquidity: string; // 原始大整数字符串
  reserve0: string;
  reserve1: string;
  lastSyncedBlock: number;
  authenticity: DataAuthenticity; // REAL_ONCHAIN（链上池数据落库）
}

/** GET /api/v1/pools 的响应结构（分页）。 */
export interface PoolListResult {
  items: PoolListItemDto[];
  page: number;
  limit: number;
  total: number;
}

/** 池子历史快照（pool_snapshots 按 block_number 升序，最多 100 条）。 */
export interface PoolSnapshotDto {
  blockNumber: number;
  reserve0: string;
  reserve1: string;
  liquidity: string;
  createdAt: string; // ISO 字符串
}

/** GET /api/v1/pools/:id 的详情 DTO（列表项 + 历史快照）。 */
export interface PoolDetailDto extends PoolListItemDto {
  snapshots: PoolSnapshotDto[];
}
