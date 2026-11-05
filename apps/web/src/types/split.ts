/**
 * 拆单路由相关类型（与后端 /api/v1/swaps/split/* 契约对齐，V1.1-3）。
 *
 * 后端统一信封：成功 { success: true, data, meta } / 失败 { success: false, error:{code,message} }。
 * 金额一律为「链上原始大整数」字符串（最小单位）；
 * 比率（priceImpact 等）一律为「十进制字符串」（禁 Float）。
 * 前端只拿后端产出的 calldata 签名广播，后端不碰私钥（非托管）。
 */

import type { PreparedApproval, PreparedTransaction } from "@/types/swap";

/** 子单协议类型（对应后端 protocolType）。 */
export type SplitProtocolType =
  | "aerodrome_classic"
  | "aerodrome_cl"
  | "uniswap_v3";

/** split/prepare 返回的单条子单执行明细（含已编码 calldata）。 */
export interface SplitChild {
  /** 子单序号（1..N）。 */
  index: number;
  poolAddress: string;
  protocolType: SplitProtocolType;
  /** 该子单输入（原始大整数）。 */
  amountIn: string;
  /** 该子单期望输出（原始大整数）。 */
  amountOut: string;
  /** 该子单独立 priceImpact（十进制字符串）。 */
  priceImpact: string;
  minimumReceived: string;
  deadline: number;
  spender: string;
  /** 该子单独立 calldata（单协议单跳，无 mixed 问题）。 */
  transaction: PreparedTransaction;
}

/** 聚合授权条目（按 spender 分组，每个不同 spender 一条，语义同 PreparedApproval）。 */
export type SplitApproval = PreparedApproval;

/** POST /api/v1/swaps/split/prepare 请求体。 */
export interface PrepareSplitParams {
  chainId: number;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  /** 输入金额（最小单位字符串）。 */
  amountIn: string;
  /** 滑点（bps，如 50 = 0.5%）。 */
  slippageBps?: number;
  /** 交易意图 ID（Analytics 埋点，可选）。 */
  intentId?: string;
  /** 最大拆分数（可选，默认 5）。 */
  maxSplits?: number;
}

/** POST /api/v1/swaps/split/prepare 返回的 data 部分。 */
export interface SplitPrepareResult {
  splitOrderId: string;
  chainId: number;
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** 各子单 amountOut 之和（原始大整数）。 */
  amountOutTotal: string;
  /** 拆分后整体价格影响（十进制字符串）。 */
  priceImpactAggregated: string;
  splits: SplitChild[];
  /** 聚合授权（按 spender 分组）。 */
  approvals: SplitApproval[];
  quoteTimestamp: string;
  notes: string[];
}

/** POST /api/v1/swaps/split/:id/submit-child 请求体。 */
export interface SubmitSplitChildParams {
  childIndex: number;
  txHash: string;
  amountOut: string;
}

/** POST /api/v1/swaps/split/:id/submit-child 返回的 data 部分。 */
export interface SubmitSplitChildResult {
  splitOrderId: string;
  childIndex: number;
  swapId: string;
  status: string;
}

/** 母单状态。 */
export type SplitOrderStatus =
  | "pending"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled";

/** 子单状态。 */
export type SplitChildStatus = "pending" | "confirmed" | "failed";

/** GET /api/v1/swaps/split/:id 返回的单个子单进度。 */
export interface SplitOrderChild {
  index: number;
  poolAddress: string;
  protocolType: string;
  amountIn: string;
  amountOut: string;
  status: SplitChildStatus;
  swapId: string | null;
  txHash: string | null;
}

/** GET /api/v1/swaps/split/:id 返回的 data 部分。 */
export interface SplitOrderDetail {
  splitOrderId: string;
  status: SplitOrderStatus;
  childCount: number;
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
  chainId: number;
  children: SplitOrderChild[];
}

/** 单路径 priceImpact 触发拆分提示的阈值（十进制字符串，1% = "0.01"）。 */
export const SPLIT_PRICE_IMPACT_THRESHOLD = "0.01";

/**
 * 十进制字符串比较 a >= b（纯字符串 + BigInt 运算，禁 Float）。
 * priceImpact 均为非负十进制字符串（如 "0.0123"），无科学计数法。
 */
export function gteDecimalString(a: string, b: string): boolean {
  const [aInt = "0", aFrac = ""] = a.replace(/^-/, "").split(".");
  const [bInt = "0", bFrac = ""] = b.replace(/^-/, "").split(".");
  const maxFrac = Math.max(aFrac.length, bFrac.length);
  const aScaled = BigInt(aInt + aFrac.padEnd(maxFrac, "0"));
  const bScaled = BigInt(bInt + bFrac.padEnd(maxFrac, "0"));
  return aScaled >= bScaled;
}

/** 判断单路径 priceImpact 是否达到「建议拆单」的阈值。 */
export function shouldSuggestSplit(priceImpact: string): boolean {
  if (!priceImpact) return false;
  return gteDecimalString(priceImpact, SPLIT_PRICE_IMPACT_THRESHOLD);
}

/** 判断母单是否已进入终态（停止轮询）。 */
export function isTerminalSplitOrderStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
