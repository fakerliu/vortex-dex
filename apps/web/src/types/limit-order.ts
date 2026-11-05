/**
 * 限价单（Limit Order）前端类型（与后端 /api/v1/limit-orders 契约对齐，V1.4）。
 *
 * 金额一律为「链上原始大整数」字符串（最小单位）；
 * 比率一律为「十进制字符串」（禁 Float）。
 * 非托管铁律：用户预签（signTransaction，不广播），keeper 广播。
 */
import { parseUnits } from "viem";

/** 限价单状态机（对齐后端 LimitOrderStatus）。 */
export type LimitOrderStatus =
  | "pending"
  | "triggered"
  | "filled"
  | "cancelled"
  | "expired"
  | "failed";

/** 限价单方向（V1.4 仅 buy；sell 预留）。 */
export type LimitOrderDirection = "buy" | "sell";

/** 待签交易清单中的单条交易（后端已补 nonce/gas，前端只负责签名）。 */
export interface LimitOrderTransactionPayload {
  kind: "approve" | "swap";
  to: string;
  value: string;
  data: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

/** 下单返回中的待签交易清单（先 approval 后 swap，nonce 连续）。 */
export interface LimitOrderSigningPayload {
  chainId: number;
  transactions: LimitOrderTransactionPayload[];
}

/** POST /api/v1/limit-orders 请求体。 */
export interface CreateLimitOrderParams {
  userAddress: string;
  chainId?: number;
  tokenIn: string;
  tokenOut: string;
  /** 链上原始大整数字符串（tokenIn 最小单位）。 */
  amountIn: string;
  /** 十进制字符串，tokenIn 每 tokenOut（如 "2500"）。 */
  limitPrice: string;
  direction?: LimitOrderDirection;
  slippageBps?: number;
  /** ISO 时间；缺省后端默认 +7 天。 */
  expiresAt?: string;
}

/** POST /api/v1/limit-orders 返回的 data 部分。 */
export interface CreateLimitOrderResult {
  order: LimitOrderDto;
  signingPayload: LimitOrderSigningPayload;
}

/** POST /api/v1/limit-orders/:id/signature 请求体。 */
export interface SubmitSignatureParams {
  userAddress: string;
  signedApprovalTx?: string;
  signedSwapTx: string;
}

/** GET /api/v1/limit-orders 查询参数。 */
export interface LimitOrderListParams {
  status?: LimitOrderStatus;
  page?: number;
  limit?: number;
}

/** GET /api/v1/limit-orders 返回的 data 部分。 */
export interface LimitOrderListResult {
  items: LimitOrderDto[];
  page: number;
  limit: number;
  total: number;
}

/** 限价单 DTO（对齐后端 LimitOrderDto）。 */
export interface LimitOrderDto {
  id: string;
  userAddress: string;
  chainId: number;
  direction: LimitOrderDirection;
  tokenIn: string;
  tokenOut: string;
  /** 原始大整数（tokenIn 最小单位）。 */
  amountIn: string;
  /** 原始大整数（权威限价）。 */
  minAmountOut: string;
  /** 十进制字符串（去尾零）。 */
  limitPrice: string;
  slippageBps: number;
  status: LimitOrderStatus;
  /** signed_swap_tx != null，keeper 只盯 armed 单。 */
  armed: boolean;
  expiresAt: string | null;
  createdAt: string;
  triggeredAt: string | null;
  filledAt: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
}

export const LIMIT_ORDER_STATUSES: LimitOrderStatus[] = [
  "pending",
  "triggered",
  "filled",
  "cancelled",
  "expired",
  "failed",
];

/** 活跃单（active）：可撤 / 待成交。 */
export const ACTIVE_LIMIT_ORDER_STATUSES: LimitOrderStatus[] = [
  "pending",
  "triggered",
];

/** 历史单（history）：终态。 */
export const HISTORY_LIMIT_ORDER_STATUSES: LimitOrderStatus[] = [
  "filled",
  "cancelled",
  "expired",
  "failed",
];

export function isTerminalLimitOrderStatus(status: string): boolean {
  return (
    status === "filled" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "failed"
  );
}

/**
 * 派生 min_amount_out（权威限价，BigInt floor，禁 Float，对齐后端 deriveMinAmountOut）：
 *   min_amount_out = floor( amount_in × 10^decimalsOut × 10^18 / ( limit_price_scaled × 10^decimalsIn ) )
 * 其中 limit_price_scaled = parseUnits(limit_price, 18)。
 * 仅用于下单前的本地预览展示，真正的权威值以后端落库为准。
 */
export function deriveMinAmountOut(
  amountIn: bigint,
  limitPrice: string,
  decimalsIn: number,
  decimalsOut: number,
): bigint {
  if (amountIn <= 0n) return 0n;
  const limitPriceScaled = parseUnits(limitPrice, 18);
  if (limitPriceScaled <= 0n) return 0n;
  const numerator =
    amountIn * 10n ** BigInt(decimalsOut) * 10n ** 18n;
  const denominator = limitPriceScaled * 10n ** BigInt(decimalsIn);
  if (denominator <= 0n) return 0n;
  // BigInt 除法对正数即 floor（向下取整）。
  return numerator / denominator;
}
