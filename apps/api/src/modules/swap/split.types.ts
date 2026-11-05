/**
 * 拆单路由（V1.1-3 Split Order Routing）DTO 与状态机。
 *
 * 金额铁律：链上原始大整数一律字符串；比率一律十进制字符串；禁 Float。
 * 非托管铁律：后端只产出 calldata + 收公开 tx_hash，绝不接触私钥。
 */

/** 母单状态机（split_orders.status）。 */
export const SplitOrderStatus = {
  PENDING: 'pending',
  PARTIAL: 'partial',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type SplitOrderStatus =
  (typeof SplitOrderStatus)[keyof typeof SplitOrderStatus];

/** 子单状态机（split_children.status）。 */
export const SplitChildStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const;

export type SplitChildStatus =
  (typeof SplitChildStatus)[keyof typeof SplitChildStatus];

/** POST /api/v1/swaps/split/prepare 请求体。 */
export interface SplitPrepareRequestDto {
  chainId?: number;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  /** 母单总输入（链上原始大整数字符串）。 */
  amountIn: string;
  /** 滑点 bps（1=0.01%），缺省取 DEFAULT_SLIPPAGE_BPS。 */
  slippageBps?: number;
  /** 交易意图 ID（可选）。 */
  intentId?: string;
  /** 最大拆分数，可选，缺省读 env SPLIT_MAX_CHILDREN。 */
  maxSplits?: number;
}

/** 拆分结果中的单个子单（含独立执行所需的 calldata / 授权 / 最小接受）。 */
export interface SplitChildPrepareDto {
  /** 子单序号（1..N）。 */
  index: number;
  poolAddress: string;
  protocolType: string;
  amountIn: string;
  amountOut: string;
  /** 该子单独立 priceImpact（十进制字符串）。 */
  priceImpact: string;
  minimumReceived: string;
  deadline: number;
  spender: string;
  transaction: {
    to: string;
    value: string;
    data: string;
    functionName: string;
    selector: string;
    gasLimit: string;
  };
}

/** 聚合授权条目（按 spender 分组，每个不同 spender 一条）。 */
export interface SplitApprovalDto {
  token: string;
  spender: string;
  amount: string;
  needed: boolean;
  data: string;
  functionName: string;
  selector: string;
}

/** POST /api/v1/swaps/split/prepare 返回结构。 */
export interface SplitPrepareResponseDto {
  splitOrderId: string;
  chainId: number;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** 各子单 amountOut 之和（原始大整数）。 */
  amountOutTotal: string;
  /** 拆分后整体价格影响（加权合成，十进制字符串）。 */
  priceImpactAggregated: string;
  splits: SplitChildPrepareDto[];
  approvals: SplitApprovalDto[];
  quoteTimestamp: string;
  notes: string[];
}

/** POST /api/v1/swaps/split/:splitOrderId/submit-child 请求体。 */
export interface SubmitSplitChildRequestDto {
  /** 对应 split.prepare 返回的 index。 */
  childIndex: number;
  /** 该子单已广播的交易哈希。 */
  txHash: string;
  /** 期望输出（占位，链上确认后由 indexer 更新）。 */
  amountOut: string;
}

/** POST /api/v1/swaps/split/:splitOrderId/submit-child 返回结构。 */
export interface SubmitSplitChildResponseDto {
  splitOrderId: string;
  childIndex: number;
  swapId: string;
  status: SplitOrderStatus;
}

/** GET /api/v1/swaps/split/:splitOrderId 返回结构中的子单条目。 */
export interface SplitOrderChildDto {
  index: number;
  poolAddress: string;
  protocolType: string;
  amountIn: string;
  amountOut: string;
  status: SplitChildStatus;
  swapId: string | null;
  txHash: string | null;
}

/** GET /api/v1/swaps/split/:splitOrderId 返回结构。 */
export interface SplitOrderDetailDto {
  splitOrderId: string;
  status: SplitOrderStatus;
  childCount: number;
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
  chainId: number;
  children: SplitOrderChildDto[];
}
