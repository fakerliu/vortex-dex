import type { Swap } from '@prisma/client';

/**
 * 交易执行模块 DTO 与状态机（Sprint 6）。
 *
 * 金额铁律：链上原始大整数一律字符串；比率一律十进制字符串；禁 Float。
 * 非托管铁律：后端绝不接收私钥/助记词/签名交易，只接收公开的 tx_hash。
 */

/**
 * 交易状态机（对应总执行文档 6.2）。
 *
 *   CREATED ──► QUOTED ──► APPROVAL_REQUIRED ──► APPROVED ──► PENDING ──► CONFIRMED
 *     │           │              │                   │             │
 *     │           │              └──（无需授权则跳过）──► APPROVED      ├──► FAILED / REVERTED
 *     │           └────────────►（无需 approve 直接）► PENDING         ├──► EXPIRED / DROPPED / REPLACED
 *     └───────────────────────► FAILED / EXPIRED（异常终止）
 *
 * 状态转换必须基于「实际钱包操作 / RPC 结果 / 链上回执」，不能广播即成功。
 */
export const SwapStatus = {
  CREATED: 'CREATED',
  QUOTED: 'QUOTED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  REVERTED: 'REVERTED',
  EXPIRED: 'EXPIRED',
  REPLACED: 'REPLACED',
  DROPPED: 'DROPPED',
} as const;

export type SwapStatus = (typeof SwapStatus)[keyof typeof SwapStatus];

/** 终态：进入后不再迁移。 */
export const TERMINAL_SWAP_STATUSES: ReadonlySet<SwapStatus> = new Set([
  SwapStatus.CONFIRMED,
  SwapStatus.FAILED,
  SwapStatus.REVERTED,
  SwapStatus.EXPIRED,
  SwapStatus.REPLACED,
  SwapStatus.DROPPED,
]);

/** 合法状态转换表（from -> 允许的 to 集合）。 */
export const SWAP_STATUS_TRANSITIONS: Record<SwapStatus, ReadonlySet<SwapStatus>> = {
  [SwapStatus.CREATED]: new Set([
    SwapStatus.QUOTED,
    SwapStatus.APPROVAL_REQUIRED,
    SwapStatus.APPROVED,
    SwapStatus.PENDING,
    SwapStatus.FAILED,
    SwapStatus.EXPIRED,
  ]),
  [SwapStatus.QUOTED]: new Set([
    SwapStatus.APPROVAL_REQUIRED,
    SwapStatus.APPROVED,
    SwapStatus.PENDING,
    SwapStatus.FAILED,
    SwapStatus.EXPIRED,
  ]),
  [SwapStatus.APPROVAL_REQUIRED]: new Set([
    SwapStatus.APPROVED,
    SwapStatus.FAILED,
    SwapStatus.EXPIRED,
  ]),
  [SwapStatus.APPROVED]: new Set([
    SwapStatus.PENDING,
    SwapStatus.FAILED,
    SwapStatus.EXPIRED,
  ]),
  [SwapStatus.PENDING]: new Set([
    SwapStatus.CONFIRMED,
    SwapStatus.FAILED,
    SwapStatus.REVERTED,
    SwapStatus.EXPIRED,
    SwapStatus.REPLACED,
    SwapStatus.DROPPED,
  ]),
  [SwapStatus.CONFIRMED]: new Set(),
  [SwapStatus.FAILED]: new Set(),
  [SwapStatus.REVERTED]: new Set(),
  [SwapStatus.EXPIRED]: new Set(),
  [SwapStatus.REPLACED]: new Set(),
  [SwapStatus.DROPPED]: new Set(),
};

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_SWAP_STATUSES.has(status as SwapStatus);
}

export function canTransition(from: string, to: string): boolean {
  const allowed = SWAP_STATUS_TRANSITIONS[from as SwapStatus];
  if (!allowed) {
    return false;
  }
  return allowed.has(to as SwapStatus);
}

/** POST /api/v1/swaps/prepare 请求体。 */
export interface PrepareSwapRequestDto {
  /** 输入 token 地址（小写规范化）。 */
  tokenIn: string;
  /** 输出 token 地址。 */
  tokenOut: string;
  /** 输入金额（链上原始大整数字符串）。 */
  amountIn: string;
  /** 用户钱包地址（小写规范化）。 */
  userAddress: string;
  /** 滑点 bps（1=0.01%），缺省取 DEFAULT_SLIPPAGE_BPS。 */
  slippageBps?: number;
  /** 链 ID，缺省 8453。 */
  chainId?: number;
  /**
   * 显式执行路径（优先于 pathId）。缺省走「直接单跳最优报价」。
   * 与路由引擎 RouteCandidate 对齐：tokenPath / poolPath / protocolPath 三数组。
   */
  route?: {
    tokenPath: string[];
    poolPath: string[];
    protocolPath: string[];
  };
  /** 路由引擎返回的 pathId（用于恢复某次多跳路径候选）。 */
  pathId?: string;
  /** CL 价格上限（sqrtPriceLimitX96，可选，默认 0 = 不设限）。 */
  sqrtPriceLimitX96?: string;
}

/** prepare 返回中的单跳执行明细。 */
export interface SwapHopDto {
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

/** POST /api/v1/swaps/prepare 返回结构。 */
export interface PrepareSwapResponseDto {
  chainId: number;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** 最新报价期望输出（原始大整数）。 */
  amountOut: string;
  /** 考虑滑点后的最小可接受输出（原始大整数）。 */
  minimumReceived: string;
  priceImpact: string;
  slippageBps: number;
  /** 交易 deadline（unix 秒，uint256）。 */
  deadline: number;
  /** 协议类型：aerodrome_classic / aerodrome_cl（多跳 mixed 暂不支持）。 */
  protocol: string;
  route: SwapHopDto[];
  /** tokenIn 实时余额（原始大整数）。 */
  balance: string;
  /** tokenIn 对 Router 的当前授权（原始大整数）。 */
  allowance: string;
  /** 授权目标合约（Router）地址。 */
  spender: string;
  /** 是否需要先 Approve（allowance < amountIn）。 */
  needsApproval: boolean;
  /** 授权所需额度（本次 amountIn，最小必要授权）。 */
  approvalAmount: string;
  /** 前端可直接签名广播的交易。 */
  transaction: {
    to: string;
    value: string;
    data: string;
    functionName: string;
    selector: string;
    /** 参考 gas limit（估算值，非链上 eth_estimateGas）。 */
    gasLimit: string;
  };
  /** 若 needsApproval 为 true，附 approve 交易的 calldata（目标=tokenIn 合约）。 */
  approval: {
    needed: boolean;
    token: string;
    spender: string;
    amount: string;
    data: string;
    functionName: string;
    selector: string;
  } | null;
  quoteTimestamp: string;
  notes: string[];
}

/** POST /api/v1/swaps/submit 请求体（只收公开 tx_hash，不收私钥/签名交易）。 */
export interface SubmitSwapRequestDto {
  /** 已广播的交易哈希（0x + 64 hex，统一小写入库）。 */
  txHash: string;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** 期望输出（来自 prepare.amountOut，确认前为占位值，链上回执确认后由 indexer 更新为实际值）。 */
  amountOut: string;
  chainId?: number;
  /** 可选初始状态，默认 PENDING（允许 APPROVAL_REQUIRED / APPROVED / PENDING）。 */
  status?: string;
}

/** Token 元数据摘要（history/detail 增强返回，用于前端展示符号与精度）。 */
export interface TokenMetaDto {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

/** 关联的链上事件摘要（用于「可核验」：tx_hash + 区块高度 + logIndex）。 */
export interface SwapEventDto {
  txHash: string;
  eventType: string;
  blockNumber: number;
  logIndex: number;
}

/** swap 详情 / 历史条目 DTO。 */
export interface SwapDto {
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
  /** 输入 token 元数据（detail/history 增强返回，可能为 null）。 */
  tokenInMeta?: TokenMetaDto | null;
  /** 输出 token 元数据。 */
  tokenOutMeta?: TokenMetaDto | null;
  /** 按 decimals 格式化后的人读金额（纯字符串运算，无 Float）。 */
  formattedAmountIn?: string | null;
  formattedAmountOut?: string | null;
  /** 关联的链上事件（可核验）。 */
  events?: SwapEventDto[];
}

export interface SwapHistoryResult {
  items: SwapDto[];
  page: number;
  limit: number;
  total: number;
}

/** 与某交易关联的链上原始事件（swap_events）。 */
export interface SwapChainEventDto {
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

/** GET /api/v1/swaps/:id 增强后的完整交易详情。 */
export interface SwapDetailDto extends SwapDto {
  /** 链上确认区块（未确认时为 null）。 */
  blockNumber: number | null;
  /** 链上回执 gasUsed（原始大整数字符串；无回执时为 null）。 */
  gasUsed: string | null;
  /** effectiveGasPrice（wei 字符串；无回执时为 null）。 */
  effectiveGasPrice: string | null;
  /** 交易失败原因（revert 时为原因字符串；成功/未知为 null）。 */
  failureReason: string | null;
  /** 区块浏览器交易链接（basescan）。 */
  explorerUrl: string;
  /** 与该交易关联的链上原始事件（Indexer swap_events，按 log_index 升序）。 */
  chainEvents: SwapChainEventDto[];
  /** 状态同步说明（是否已查链、依据什么来源）。 */
  statusSync: {
    source: 'receipt' | 'indexer' | 'none' | 'rpc_error';
    syncedAt: string;
  };
}

export function toSwapDto(swap: Swap): SwapDto {
  return {
    id: swap.id,
    userAddress: swap.user_address,
    tokenIn: swap.token_in,
    tokenOut: swap.token_out,
    amountIn: swap.amount_in.toString(),
    amountOut: swap.amount_out.toString(),
    txHash: swap.tx_hash,
    status: swap.status as SwapStatus,
    chainId: swap.chain_id,
    createdAt: swap.created_at.toISOString(),
    confirmedAt: swap.confirmed_at ? swap.confirmed_at.toISOString() : null,
  };
}
