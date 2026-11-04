import type { RouteCandidate } from '@prisma/client';

/**
 * 路由引擎 DTO（Sprint 5）。
 * 金额一律「链上原始大整数」字符串；比率一律「十进制字符串」，禁 Float。
 */

/** POST /api/v1/route 请求体。 */
export interface RouteRequestDto {
  tokenIn: string;
  tokenOut: string;
  /** 输入金额（链上原始大整数字符串）。 */
  amountIn: string;
  chainId?: number;
  /** 最大跳数（= 池子数量），默认 2，上限 3。 */
  maxPathLength?: number;
  /** 允许的协议类型白名单（如 ['aerodrome_classic','aerodrome_cl']），缺省全用。 */
  protocols?: string[];
  /** 可选的多跳中间 token（默认 WETH + USDC）。 */
  hubTokens?: string[];
  /** 交易意图 ID（Analytics 事件采集用，可选）。 */
  intentId?: string;
  /** 钱包地址（Analytics 事件采集用，可选）。 */
  userAddress?: string;
}

/** 单跳明细（POST 返回用，便于审计整条路径）。 */
export interface RouteHopDto {
  pool: string;
  kind: string;
  protocolType: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  fee: string;
  priceImpact: string;
  source: string;
  gasEstimate: string;
}

/** 一条候选路径。 */
export interface RouteCandidateDto {
  tokenPath: string[];
  poolPath: string[];
  protocolPath: string[];
  amountIn: string;
  amountOut: string;
  estimatedGas: string;
  /** Gas 换算成输出 token 的原始单位（无法换算时为 "0"）。 */
  gasCostInOutputToken: string;
  /** NetOutput = amountOut - gasCostInOutputToken（无法换算时 = amountOut）。 */
  netOutput: string;
  priceImpact: string;
  routeScore: string;
  /** 是否成功把 gas 换算成输出 token 并从 netOutput 中扣除。 */
  gasConverted: boolean;
  /** POST 返回的逐跳明细（GET 不返回）。 */
  hops?: RouteHopDto[];
}

/** POST /api/v1/route 与 GET /api/v1/route/:pathId 的返回结构。 */
export interface RouteResponseDto {
  pathId: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  blockNumber: number | null;
  gasPriceWei: string | null;
  gasPriceSource: string | null;
  gasConversionMethod: string;
  candidates: RouteCandidateDto[];
  quoteTimestamp: string;
}

/** Prisma RouteCandidate 行 -> 候选 DTO。 */
export function toRouteCandidateDto(row: RouteCandidate): RouteCandidateDto {
  let tokenPath: string[] = [];
  let poolPath: string[] = [];
  let protocolPath: string[] = [];
  try {
    tokenPath = JSON.parse(row.token_path) as string[];
  } catch {
    tokenPath = [];
  }
  try {
    poolPath = JSON.parse(row.pool_path) as string[];
  } catch {
    poolPath = [];
  }
  try {
    protocolPath = JSON.parse(row.protocol_path) as string[];
  } catch {
    protocolPath = [];
  }

  const amountOut = row.amount_out.toString();
  const netOutput = row.net_output.toString();

  return {
    tokenPath,
    poolPath,
    protocolPath,
    amountIn: row.amount_in.toString(),
    amountOut,
    estimatedGas: row.estimated_gas.toString(),
    gasCostInOutputToken: (BigInt(amountOut) - BigInt(netOutput)).toString(),
    netOutput,
    priceImpact: row.price_impact.toString(),
    routeScore: row.route_score.toString(),
    gasConverted: BigInt(netOutput) < BigInt(amountOut),
  };
}
