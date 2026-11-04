import type { Quote } from '@prisma/client';
import { formatFraction } from '../../dex/math';

/**
 * 报价引擎 DTO（Sprint 4）。
 * 金额一律「链上原始大整数」字符串；比率一律「十进制字符串」，禁 Float。
 */

/** POST /api/v1/quote 请求体。 */
export interface QuoteRequestDto {
  /** 输入 token 地址（0x，大小写均可，内部小写规范化）。 */
  tokenIn: string;
  /** 输出 token 地址。 */
  tokenOut: string;
  /** 输入金额（链上原始大整数字符串）。 */
  amountIn: string;
  /** 链 ID，缺省 8453（Base Mainnet）。 */
  chainId?: number;
  /** 滑点（basis points，1=0.01%），缺省取 DEFAULT_SLIPPAGE_BPS。 */
  slippageBps?: number;
  /** 允许的协议类型白名单（如 ['aerodrome_classic','aerodrome_cl']），缺省全用。 */
  protocols?: string[];
  /** 最大路径长度；Sprint 4 仅支持单跳（=1）。 */
  maxPathLength?: number;
}

/** 报价结果中的单跳路径条目。 */
export interface QuoteRouteStep {
  pool: string;
  kind: string;
}

/** POST /api/v1/quote 与 GET /api/v1/quote/:id 的返回结构。 */
export interface QuoteResponseDto {
  id: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  /** 输入金额（原始大整数）。 */
  amountIn: string;
  /** 输出金额（原始大整数）。 */
  amountOut: string;
  /** 人读价格（tokenOut 兑 tokenIn，十进制字符串）。 */
  price: string;
  /** 考虑滑点后的最小可接受输出（原始大整数）。 */
  minimumReceived: string;
  /** 价格影响（十进制字符串，如 "0.000248"）。 */
  priceImpact: string;
  /** 手续费（ppm 字符串，1e6=100%）。 */
  swapFee: string;
  /** 手续费（十进制小数，如 "0.00015" = 0.015%）。 */
  swapFeeFraction: string;
  /** gas 估算（原始 gas 单位）。 */
  gasEstimate: string;
  /** 来源协议 protocol_type。 */
  protocol: string;
  /** 来源协议名称。 */
  protocolName: string;
  /** 单跳路径。 */
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

/** Prisma Quote 行 -> 响应 DTO。 */
export function toQuoteResponseDto(q: Quote): QuoteResponseDto {
  let route: QuoteRouteStep[] = [];
  if (q.route) {
    try {
      route = JSON.parse(q.route) as QuoteRouteStep[];
    } catch {
      route = [];
    }
  }

  const swapFee = q.swap_fee ?? '0';

  return {
    id: q.id,
    chainId: q.chain_id,
    tokenIn: q.token_in,
    tokenOut: q.token_out,
    amountIn: q.amount_in.toString(),
    amountOut: q.amount_out.toString(),
    price: q.price ?? '0',
    minimumReceived: q.minimum_received?.toString() ?? q.amount_out.toString(),
    priceImpact: q.price_impact.toString(),
    swapFee,
    swapFeeFraction: ppmToFraction(swapFee),
    gasEstimate: q.gas_estimate.toString(),
    protocol: q.protocol ?? '',
    protocolName: protocolNameOf(q.protocol ?? ''),
    route,
    source: q.source ?? '',
    blockNumber: q.block_number ?? null,
    quoteTimestamp: q.created_at.toISOString(),
    quoteExpiration: q.expires_at?.toISOString() ?? q.created_at.toISOString(),
  };
}

/** ppm 字符串 -> 十进制小数字符串（如 "150" -> "0.00015"）。 */
export function ppmToFraction(ppm: string): string {
  const n = BigInt(ppm || '0');
  if (n === 0n) {
    return '0';
  }
  return formatFraction(n, 1_000_000n, 18);
}

function protocolNameOf(protocolType: string): string {
  if (protocolType === 'aerodrome_classic' || protocolType === 'aerodrome_cl') {
    return 'Aerodrome';
  }
  if (protocolType === 'uniswap_v3') {
    return 'Uniswap V3';
  }
  return protocolType;
}
