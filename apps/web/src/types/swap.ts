/**
 * 交易执行相关类型（与后端 POST /api/v1/swaps/prepare、/submit 契约对齐，Sprint 6）。
 *
 * 后端统一信封：
 * - 成功：{ success: true, data: <...> }
 * - 失败：{ success: false, error: { code, message }, path, timestamp }
 *
 * 金额一律为「链上原始大整数」字符串（最小单位）；
 * 比率一律为「十进制字符串」（禁 Float）。
 * 非托管铁律：前端只拿后端产出的 calldata 签名广播，后端不碰私钥。
 */

/** 交易状态机（与后端 SwapStatus 对齐）。 */
export type SwapStatus =
  | "CREATED"
  | "QUOTED"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "PENDING"
  | "CONFIRMED"
  | "FAILED"
  | "REVERTED"
  | "EXPIRED"
  | "REPLACED"
  | "DROPPED";

/** prepare 返回中的单跳执行明细。 */
export interface SwapHop {
  pool: string;
  protocol: string;
  kind: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  fee: string;
  /** classic 池 stable 标记（仅 classic 有）。 */
  stable?: boolean;
  /** CL 池 tickSpacing（仅 CL 有）。 */
  tickSpacing?: number;
}

/** 已编码好的交易 calldata（前端直接签名广播，不再自行 encode）。 */
export interface PreparedTransaction {
  to: string;
  value: string;
  data: string;
  functionName: string;
  selector: string;
  /** 参考 gas limit（估算值）。 */
  gasLimit: string;
}

/** 已编码好的 approve calldata（目标 = tokenIn 合约）。 */
export interface PreparedApproval {
  needed: boolean;
  token: string;
  spender: string;
  amount: string;
  data: string;
  functionName: string;
  selector: string;
}

/** POST /api/v1/swaps/prepare 请求体。 */
export interface PrepareSwapParams {
  tokenIn: string;
  tokenOut: string;
  /** 输入金额（最小单位字符串）。 */
  amountIn: string;
  /** 用户钱包地址（小写）。 */
  userAddress: string;
  slippageBps?: number;
  chainId?: number;
}

/** POST /api/v1/swaps/prepare 返回的 data 部分。 */
export interface PrepareSwapResult {
  chainId: number;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  minimumReceived: string;
  priceImpact: string;
  slippageBps: number;
  deadline: number;
  protocol: string;
  route: SwapHop[];
  balance: string;
  allowance: string;
  spender: string;
  needsApproval: boolean;
  approvalAmount: string;
  transaction: PreparedTransaction;
  approval: PreparedApproval | null;
  quoteTimestamp: string;
  notes: string[];
}

/** POST /api/v1/swaps/submit 请求体（只收公开 tx_hash）。 */
export interface SubmitSwapParams {
  txHash: string;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  chainId?: number;
  status?: string;
  /** 交易意图 ID（Analytics 埋点，可选）。 */
  intentId?: string;
  /** 关联报价 ID（Analytics 埋点，可选）。 */
  quoteId?: string;
}

/** POST /api/v1/swaps/submit 返回的 data 部分。 */
export interface SwapRecord {
  id: string;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
  status: SwapStatus;
  chainId: number;
  createdAt: string;
  confirmedAt: string | null;
}

/** 判断是否已进入终态。 */
export function isTerminalSwapStatus(status: string): boolean {
  return (
    status === "CONFIRMED" ||
    status === "FAILED" ||
    status === "REVERTED" ||
    status === "EXPIRED" ||
    status === "REPLACED" ||
    status === "DROPPED"
  );
}
