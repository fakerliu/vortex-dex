/**
 * 限价单（V1.4 Limit Order，Phase 1 链下 keeper）DTO 与状态机。
 *
 * 金额铁律：链上原始大整数一律字符串；比率（limit_price）一律十进制字符串；禁 Float。
 * 非托管铁律：keeper 无执行私钥，只广播用户预签的 raw tx。
 */

/**
 * 限价单状态机（对应架构 §4.2）。
 *
 *   PENDING ──(keeper 盯价 quote.amountOut >= min_amount_out, CAS)──► TRIGGERED
 *     │(user cancel, CAS)──► CANCELLED（终态）
 *     │(expires_at < now, keeper 清扫)──► EXPIRED（终态）
 *   TRIGGERED ──(广播+回执 success)──► FILLED（终态）
 *             ──(revert / nonce 失效 / 余额不足 / allowance 不足)──► FAILED（终态）
 */
export const LimitOrderStatus = {
  PENDING: 'pending',
  TRIGGERED: 'triggered',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  FAILED: 'failed',
} as const;

export type LimitOrderStatus =
  (typeof LimitOrderStatus)[keyof typeof LimitOrderStatus];

/** 终态：进入后不再迁移。 */
export const TERMINAL_LIMIT_ORDER_STATUSES: ReadonlySet<string> = new Set([
  LimitOrderStatus.FILLED,
  LimitOrderStatus.CANCELLED,
  LimitOrderStatus.EXPIRED,
  LimitOrderStatus.FAILED,
]);

/** 合法状态转换表（from -> 允许的 to 集合）。 */
export const LIMIT_ORDER_STATUS_TRANSITIONS: Record<
  string,
  ReadonlySet<string>
> = {
  [LimitOrderStatus.PENDING]: new Set([
    LimitOrderStatus.TRIGGERED,
    LimitOrderStatus.CANCELLED,
    LimitOrderStatus.EXPIRED,
    LimitOrderStatus.FAILED,
  ]),
  [LimitOrderStatus.TRIGGERED]: new Set([
    LimitOrderStatus.FILLED,
    LimitOrderStatus.FAILED,
  ]),
  [LimitOrderStatus.FILLED]: new Set(),
  [LimitOrderStatus.CANCELLED]: new Set(),
  [LimitOrderStatus.EXPIRED]: new Set(),
  [LimitOrderStatus.FAILED]: new Set(),
};

export function isTerminalLimitOrderStatus(status: string): boolean {
  return TERMINAL_LIMIT_ORDER_STATUSES.has(status);
}

export function canTransitionLimitOrder(from: string, to: string): boolean {
  const allowed = LIMIT_ORDER_STATUS_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.has(to);
}

/** 限价单方向：buy（V1.4 先做）/ sell（镜像预留）。 */
export type LimitOrderDirection = 'buy' | 'sell';

/** POST /api/v1/limit-orders 请求体（架构 §9.1）。 */
export interface CreateLimitOrderRequestDto {
  userAddress: string;
  chainId?: number; // 缺省 8453
  tokenIn: string; // 用户付出的币
  tokenOut: string; // 用户买入的币
  amountIn: string; // 链上原始大整数字符串
  limitPrice: string; // 十进制字符串，tokenIn 每 tokenOut（如 "0.0004"）
  direction?: LimitOrderDirection; // V1.4 仅 buy
  slippageBps?: number; // 默认 0
  expiresAt?: string; // ISO 时间；缺省后端默认 +7 天（有上界）
}

/** 下单返回中的待签交易清单（用户在钱包依次签名，先 approval 后 swap，nonce 连续）。 */
export interface SigningPayloadDto {
  chainId: number;
  transactions: Array<{
    kind: 'approve' | 'swap';
    to: string;
    value: string;
    data: string;
    nonce: number;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }>;
}

export interface CreateLimitOrderResponseDto {
  order: LimitOrderDto;
  signingPayload: SigningPayloadDto;
}

/** POST /api/v1/limit-orders/:id/signature 请求体（架构 §9.2）。 */
export interface SubmitSignatureRequestDto {
  userAddress: string;
  signedApprovalTx?: string; // 0x raw hex（下单时 needsApproval 才有）
  signedSwapTx: string; // 0x raw hex
}

/** GET /api/v1/limit-orders 分页查询参数。 */
export interface LimitOrderListQueryDto {
  user: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface LimitOrderListResultDto {
  items: LimitOrderDto[];
  page: number;
  limit: number;
  total: number;
}

/** 限价单 DTO（架构 §9.5，字段口径）。 */
export interface LimitOrderDto {
  id: string;
  userAddress: string;
  chainId: number;
  direction: LimitOrderDirection;
  tokenIn: string;
  tokenOut: string;
  amountIn: string; // 原始大整数
  minAmountOut: string; // 原始大整数（权威限价）
  limitPrice: string; // 十进制字符串（去尾零）
  slippageBps: number;
  status: LimitOrderStatus;
  armed: boolean; // signed_swap_tx != null
  expiresAt: string | null;
  createdAt: string;
  triggeredAt: string | null;
  filledAt: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
}

/** keeper 单轮运行结果（供手动触发端点与日志）。 */
export interface KeeperRunResultDto {
  sweptExpired: number;
  triggered: number;
  filled: number;
  failed: number;
  skipped: number;
  reconciled: number;
  startedAt: string;
}

/** Prisma.Decimal -> 干净十进制字符串（去尾零），null 透传。 */
export function decimalToString(
  d: { toString(): string } | null | undefined,
): string | null {
  if (d == null) {
    return null;
  }
  let s = d.toString();
  if (s.includes('.')) {
    s = s.replace(/0+$/, '');
    s = s.replace(/\.$/, '');
  }
  return s;
}
