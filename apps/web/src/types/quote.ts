/**
 * 报价相关类型与接口占位。
 * Phase 1 不接后端报价引擎，这里只定义清晰契约，不使用假数字。
 */

export interface RouteStep {
  pool: string;
  poolType: "V2" | "V3" | "CL" | "STABLE";
  feeBps: number;
  tokenIn: string;
  tokenOut: string;
  /** 该段在整条路由中的占比 0-100 */
  portion: number;
}

export interface Quote {
  chainId: number;
  inputToken: string;
  outputToken: string;
  /** 输入/输出均以最小单位（wei）字符串表示，前端用大数库格式化 */
  inputAmount: string;
  outputAmount: string;
  /** 人类可读汇率，如 "1 WETH = 3,412.50 USDC" */
  exchangeRate: string;
  /** 价格影响，百分比数值，如 0.12 表示 0.12% */
  priceImpact: number;
  /** 网络费（gas）估算，人类可读，如 "~$0.32" */
  networkFee: string;
  /** 协议费，人类可读 */
  protocolFee: string;
  /** 按滑点计算的最小获得数量（人类可读字符串） */
  minimumReceived: string;
  /** 输出代币的美元估值（人类可读，如 "$1,234.56"），Phase 2 由后端提供 */
  usdValue?: string;
  route: RouteStep[];
  /** 报价来源标识 */
  provider: string;
  /** 报价过期时间戳（ms） */
  expiresAt: number;
}

export interface QuoteParams {
  chainId: number;
  inputToken: string;
  outputToken: string;
  /** 输入金额，最小单位字符串 */
  inputAmount: string;
  /** 滑点，bps（如 50 表示 0.5%） */
  slippageBps: number;
  recipient?: string;
}
