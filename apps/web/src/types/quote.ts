/**
 * 报价相关类型（与后端真实契约对齐，Sprint 4 报价引擎）。
 *
 * 后端统一信封：
 * - 成功：{ success: true, data: <Quote> }
 * - 失败：{ success: false, error: { code, message }, path, timestamp }
 *
 * 金额一律为「链上原始大整数」字符串（最小单位）；
 * 比率一律为「十进制字符串」（禁 Float）。
 * 前端展示需要的派生字段（汇率文案、百分比、人类可读金额）一律在组件内计算，
 * 不在类型里硬塞。
 */

/** 报价结果中的单跳路径条目（后端字段名 kind，如 "cl" / "classic"）。 */
export interface QuoteRouteStep {
  pool: string;
  kind: string;
}

/** POST /api/v1/quote 返回的报价数据（data 部分）。 */
export interface Quote {
  id: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  /** 输入金额（最小单位字符串）。 */
  amountIn: string;
  /** 输出金额（最小单位字符串）。 */
  amountOut: string;
  /** 人读价格（tokenOut 兑 tokenIn，十进制字符串，如 "2276.55541"）。 */
  price: string;
  /** 考虑滑点后的最小可接受输出（最小单位字符串）。 */
  minimumReceived: string;
  /** 价格影响（十进制字符串，如 "0.000253390435906198" = 0.0253%）。 */
  priceImpact: string;
  /** 手续费（ppm 字符串，1e6 = 100%，如 "150" = 0.015%）。 */
  swapFee: string;
  /** 手续费（十进制小数，如 "0.00015" = 0.015%）。 */
  swapFeeFraction: string;
  /** gas 估算（原始 gas 单位字符串）。 */
  gasEstimate: string;
  /** 来源协议 protocol_type（如 "aerodrome_cl"）。 */
  protocol: string;
  /** 来源协议名称（如 "Aerodrome"）。 */
  protocolName: string;
  /** 最优单跳路径。 */
  route: QuoteRouteStep[];
  /** 报价来源（constant-product / quoter / onchain-getAmountOut）。 */
  source: string;
  /** 报价时区块高度。 */
  blockNumber: number | null;
  /** 报价时间（ISO 8601）。 */
  quoteTimestamp: string;
  /** 报价过期时间（ISO 8601）。 */
  quoteExpiration: string;
}

/** POST /api/v1/quote 请求体（前端请求参数）。 */
export interface QuoteParams {
  tokenIn: string;
  tokenOut: string;
  /** 输入金额，最小单位字符串。 */
  amountIn: string;
  chainId: number;
  /** 滑点，bps（如 50 = 0.5%）。 */
  slippageBps?: number;
  /** 交易意图 ID（Analytics 埋点，可选）。 */
  intentId?: string;
}
