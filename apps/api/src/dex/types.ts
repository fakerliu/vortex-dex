/**
 * DEX Adapter 统一类型定义（Sprint 3）。
 *
 * 精度铁律：
 * - 所有金额 / 流动性 / 储备量一律用「链上原始大整数」的字符串表示（BigInt 语义），
 *   绝不使用 Float / number 参与金额运算。
 * - 比率类（价格、价格影响、滑点）用「十进制字符串」表示（如 "0.0012"），
 *   内部计算用 BigInt 定点数，避免浮点误差。
 *
 * fee 规范化约定（重要）：
 * - `fee` 统一用「ppm（parts per million）」表示：1_000_000 = 100%。
 *   例如 0.30% => "3000"，0.05% => "500"，0.015% => "150"。
 * - classic 池（Velodrome v2 fork）链上 getFee 返回的是 bps（30 = 0.30%），
 *   Adapter 内部会 ×100 转成 ppm。
 * - CL 池（Slipstream，Uniswap v3 fork）链上 fee() 本身就是 ppm（3000 = 0.30%）。
 * 本约定与 pools 表的 fee 字段注释（如 Uniswap V3 的 3000 = 0.3%）一致。
 */

export type PoolKind = 'classic-volatile' | 'classic-stable' | 'cl';

/** 协议元信息（getProtocolInfo 返回值）。 */
export interface ProtocolInfo {
  chainId: number;
  name: string;
  /** 协议子类型，用于区分 classic / CL 两套合约。 */
  protocolType: string;
  version: string;
  factoryAddress: string | null;
  routerAddress: string | null;
  quoterAddress: string | null;
  /** 是否已通过链上 RPC 核验（非仅凭文档地址）。 */
  verified: boolean;
  /** 核验来源说明（文档 URL + 链上调用方式），做到可溯源。 */
  verificationSource: string;
}

/** 流动性池（discoverPools 返回值）。 */
export interface Pool {
  chainId: number;
  /** 池子地址（小写规范化）。 */
  address: string;
  token0: string;
  token1: string;
  kind: PoolKind;
  /** 规范化费率（ppm，1_000_000 = 100%）。 */
  fee: string;
  /** 链上原始费率值（classic 为 bps；CL 为 ppm）。用于溯源。 */
  feeRaw: string;
  /** classic 池是否稳定币池（stableswap 不变式，非 x*y=k）。 */
  stable?: boolean;
  /** CL 池的 tickSpacing。 */
  tickSpacing?: number;
}

/** 池子实时状态（getPoolState 返回值）。 */
export interface PoolState {
  chainId: number;
  address: string;
  kind: PoolKind;
  token0: string;
  token1: string;
  fee: string;
  feeRaw: string;
  stable?: boolean;
  tickSpacing?: number;
  /** classic：reserve0 / reserve1（链上原始大整数）。 */
  reserve0?: string;
  reserve1?: string;
  /** classic：LP 总供应量（totalSupply）。 */
  totalSupply?: string;
  /** CL：当前 sqrt 流动性 L（liquidity()）。 */
  liquidity?: string;
  /** CL：sqrtPriceX96（slot0）。 */
  sqrtPriceX96?: string;
  /** CL：当前 tick（slot0）。 */
  tick?: number;
  /** CL：slot0 中的动态费率字段（uint16，Aerodrome 动态手续费）。 */
  dynamicFee?: number;
  /** 读取时所在区块号。 */
  blockNumber: number;
}

/** 单池报价入参（getQuote）。 */
export interface QuoteParams {
  chainId: number;
  /** 池子地址（小写）。 */
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  /** 输入金额（链上原始大整数字符串）。 */
  amountIn: string;
  /** 价格上限（CL 报价用 sqrtPriceLimitX96），缺省 0 表示不设限。 */
  sqrtPriceLimitX96?: string;
}

/** 单池报价结果（getQuote）。 */
export interface QuoteResult {
  chainId: number;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** 输出金额（链上原始大整数字符串）。 */
  amountOut: string;
  kind: PoolKind;
  fee: string;
  /** 价格影响（十进制字符串，如 "0.0012" = 0.12%）。CL 为近似值。 */
  priceImpact: string;
  /** 报价来源，用于交叉验证与审计。 */
  source: 'onchain-getAmountOut' | 'quoter' | 'constant-product';
  /** 单跳路径摘要。 */
  route: { pool: string; kind: PoolKind }[];
  /** 可选 gas 估算（部分 adapter 可在报价时一并得到，如 CL 的 Quoter 返回 gasEstimate）。 */
  gasEstimate?: string;
}

/** Gas 估算结果（estimateGas）。 */
export interface GasEstimate {
  /** 估算 gas limit（wei 大整数字符串）。 */
  gasLimit: string;
  /** 估算方式。 */
  source: 'static' | 'eth_estimateGas' | 'quoter-simulation';
  /** 是否仅为估算值（非链上 simulate）。 */
  estimated: boolean;
  /** 说明文字。 */
  note?: string;
}
