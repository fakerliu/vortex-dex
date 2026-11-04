import type { User } from '@prisma/client';

/**
 * 用户系统 DTO（Sprint 8 交易记录与用户系统）。
 * 金额一律「链上原始大整数」字符串；禁 Float。
 */

/** 交易统计：swaps（平台提交）∪ swap_events（链上原始事件），按 tx_hash 去重。 */
export interface UserStats {
  /** 唯一交易数（去重后）。 */
  totalSwaps: number;
  /** 已确认（链上成功）。 */
  confirmed: number;
  /** 失败 / 回滚。 */
  failed: number;
  /** 待确认等非终态。 */
  pending: number;
  /** 来自平台 swaps 表的记录数。 */
  sourcePlatform: number;
  /** 来自链上原始事件 swap_events 的唯一 tx 数（去重）。 */
  sourceChain: number;
}

export interface UserProfileDto {
  /** 钱包地址（小写规范化）。 */
  address: string;
  /** 注册时间（未注册时为 null）。 */
  createdAt: string | null;
  stats: UserStats;
}

export function toUserProfileDto(
  address: string,
  user: User | null,
  stats: UserStats,
): UserProfileDto {
  return {
    address,
    createdAt: user ? user.created_at.toISOString() : null,
    stats,
  };
}

/** 用户交易列表条目（统一平台 swaps 与链上 swap_events）。 */
export interface UserSwapRecordDto {
  id: string;
  /** 数据来源：platform（平台提交）| chain（链上原始事件）。 */
  source: 'platform' | 'chain';
  txHash: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  /** 状态：平台记录用自身状态（已按链上同步）；链上事件固定 CONFIRMED。 */
  status: string;
  blockNumber: number | null;
  /** 交易时间（ISO）：平台=confirmedAt/createdAt；链上=索引时间（swap_events 未存区块时间）。 */
  timestamp: string;
  explorerUrl: string;
  pool: string | null;
  protocolType: string | null;
}

export interface UserSwapListResult {
  items: UserSwapRecordDto[];
  page: number;
  limit: number;
  total: number;
}
