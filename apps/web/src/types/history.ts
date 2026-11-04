/**
 * 用户交易历史类型（与后端 GET /api/v1/users/:address/swaps 契约严格对齐，Sprint 8）。
 *
 * 金额一律为「链上原始大整数」字符串（最小单位），禁 Float；
 * 时间一律为 ISO 8601 字符串；token 字段为合约地址（无 symbol/decimals，
 * 由前端通过 config/tokens 解析元数据，未收录时回退显示地址截断）。
 */

/** 数据来源：platform（平台提交）| chain（链上原始事件）。 */
export type SwapRecordSource = "platform" | "chain";

/** 用户交易列表条目。 */
export interface SwapHistoryRecord {
  id: string;
  source: SwapRecordSource;
  txHash: string;
  chainId: number;
  /** 输入 token 地址（小写规范化）。 */
  tokenIn: string;
  /** 输出 token 地址（小写规范化）。 */
  tokenOut: string;
  /** 输入金额（链上原始大整数字符串）。 */
  amountIn: string;
  /** 输出金额（链上原始大整数字符串）。 */
  amountOut: string;
  /** 状态（SwapStatus 字符串，如 CONFIRMED / PENDING / FAILED）。 */
  status: string;
  blockNumber: number | null;
  /** 交易时间（ISO 8601）。 */
  timestamp: string;
  /** 区块浏览器交易链接（后端已拼好完整 URL）。 */
  explorerUrl: string;
  pool: string | null;
  protocolType: string | null;
}

/** 分页查询参数。 */
export interface SwapHistoryParams {
  /** 页码，从 1 开始，缺省 1。 */
  page?: number;
  /** 每页条数，缺省 20，最大 100。 */
  limit?: number;
  chainId?: number;
}

/** 分页结果。 */
export interface SwapHistoryResult {
  items: SwapHistoryRecord[];
  page: number;
  limit: number;
  total: number;
}
