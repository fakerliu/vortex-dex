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

/** 与某交易关联的链上原始事件（swap_events，按 log_index 升序）。 */
export interface SwapChainEvent {
  id: string;
  eventType: string;
  blockNumber: number;
  logIndex: number;
  pool: string | null;
  protocolType: string | null;
  family: string | null;
  tokenIn: string | null;
  tokenOut: string | null;
  amountIn: string | null;
  amountOut: string | null;
  sender: string | null;
  recipient: string | null;
}

/**
 * 单笔交易详情（GET /api/v1/swaps/:id 的 data 部分，Sprint 8 增强）。
 * 注意：后端 getSwap 只返回 SwapDto 基础字段 + 下列链上增强字段，
 * 不含 tokenInMeta/tokenOutMeta（symbol/decimals 由前端经 config/tokens 解析）。
 */
export interface SwapDetail {
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
  /** 链上确认区块高度（未确认时为 null）。 */
  blockNumber: number | null;
  /** 链上回执 gasUsed（原始大整数字符串；无回执时为 null）。 */
  gasUsed: string | null;
  /** effectiveGasPrice（wei 字符串；无回执时为 null）。 */
  effectiveGasPrice: string | null;
  /** 失败原因（revert 时为原因字符串；成功/未知为 null）。 */
  failureReason: string | null;
  /** 区块浏览器交易链接（后端已拼好完整 URL）。 */
  explorerUrl: string;
  /** 关联链上原始事件（按 log_index 升序）。 */
  chainEvents: SwapChainEvent[];
  /** 状态同步说明（依据回执 / indexer / 无 / RPC 错误）。 */
  statusSync: {
    source: "receipt" | "indexer" | "none" | "rpc_error";
    syncedAt: string;
  };
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
