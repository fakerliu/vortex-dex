/**
 * DEX 报价定点数运算工具（纯 BigInt + 字符串，绝不使用 Float）。
 *
 * 约定：
 * - 所有金额为链上原始大整数（bigint）。
 * - 比率统一用「分子/分母」表示，最后经 formatFraction 输出十进制字符串。
 */
import { formatUnits } from '../common/utils/units';

/** 将十进制字符串安全解析为 BigInt（空串/非法抛错）。 */
export function parseAmount(raw: string): bigint {
  const s = raw.trim();
  if (!/^-?\d+$/.test(s)) {
    throw new Error(`非法金额（必须为整数字符串）: ${raw}`);
  }
  return BigInt(s);
}

/** 定点除法：num/den，保留 precision 位小数，返回十进制字符串（去尾零）。 */
export function formatFraction(
  num: bigint,
  den: bigint,
  precision = 18,
): string {
  if (den === 0n) {
    throw new Error('除数不能为 0');
  }
  const scale = 10n ** BigInt(precision);
  const scaled = (num * scale) / den;
  return formatUnits(scaled.toString(), precision);
}

/**
 * V2 恒定乘积（x*y=k）报价，含手续费（feePpm 为 ppm，1e6=100%）。
 *
 *   amountInWithFee = amountIn * (1e6 - feePpm) / 1e6
 *   amountOut       = reserveOut * amountInWithFee / (reserveIn + amountInWithFee)
 */
export function getAmountOutConstantProduct(params: {
  reserveIn: bigint;
  reserveOut: bigint;
  amountIn: bigint;
  feePpm: bigint;
}): bigint {
  const { reserveIn, reserveOut, amountIn, feePpm } = params;
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error('恒定乘积报价要求 amountIn/reserves 均为正数');
  }
  if (feePpm < 0n || feePpm >= 1_000_000n) {
    throw new Error(`非法费率（ppm）: ${feePpm}`);
  }
  const amountInWithFee =
    (amountIn * (1_000_000n - feePpm)) / 1_000_000n;
  if (amountInWithFee <= 0n) {
    return 0n;
  }
  return (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
}

/**
 * 价格影响（slippage/price impact）十进制字符串。
 *
 * 统一定义：priceImpact = 1 - executionPrice / midPrice
 *   midPrice（tokenOut 兑 tokenIn 的即期价，raw）= midNum / midDen
 *   executionPrice = amountOut / amountIn
 *
 * 不同池子只需给出对应的 midNum/midDen：
 * - classic volatile：midNum=reserveOut, midDen=reserveIn
 * - CL（token0->token1）：midNum=sqrtP^2, midDen=2^192
 * - CL（token1->token0）：midNum=2^192, midDen=sqrtP^2
 */
export function computePriceImpact(params: {
  amountIn: bigint;
  amountOut: bigint;
  midNum: bigint;
  midDen: bigint;
}): string {
  const { amountIn, amountOut, midNum, midDen } = params;
  if (amountIn <= 0n || midNum <= 0n || midDen <= 0n) {
    return '0';
  }
  // num = amountIn*midNum - amountOut*midDen
  const num = amountIn * midNum - amountOut * midDen;
  if (num <= 0n) {
    return '0';
  }
  const den = amountIn * midNum;
  return formatFraction(num, den, 18);
}

/** 2^192（CL sqrtPriceX96 定价的固定分母）。 */
export const Q192 = 1n << 192n;

/**
 * 基于「即期价 probe」的价格影响（适用于无解析即期价的池子，如 stableswap）。
 *
 *   spotPrice       = spotPriceNum / spotPriceDen（用小额 probe 交易得到的边际价）
 *   executionPrice  = amountOut / amountIn
 *   priceImpact     = 1 - executionPrice / spotPrice
 */
export function computePriceImpactFromSpot(params: {
  amountIn: bigint;
  amountOut: bigint;
  spotPriceNum: bigint;
  spotPriceDen: bigint;
}): string {
  const { amountIn, amountOut, spotPriceNum, spotPriceDen } = params;
  if (
    amountIn <= 0n ||
    spotPriceNum <= 0n ||
    spotPriceDen <= 0n
  ) {
    return '0';
  }
  const num = amountIn * spotPriceNum - amountOut * spotPriceDen;
  if (num <= 0n) {
    return '0';
  }
  const den = amountIn * spotPriceNum;
  return formatFraction(num, den, 18);
}

/** CL：由 sqrtPriceX96 计算 token1/token0 即期价分子分母（raw，不含 decimals）。 */
export function sqrtPriceX96ToMidPrice(
  sqrtPriceX96: bigint,
  tokenInIsToken0: boolean,
): { midNum: bigint; midDen: bigint } {
  const p = sqrtPriceX96 * sqrtPriceX96; // price = sqrtP^2 / 2^192（token1 per token0）
  return tokenInIsToken0
    ? { midNum: p, midDen: Q192 }
    : { midNum: Q192, midDen: p };
}

/**
 * 人读价格（tokenOut 兑 tokenIn，十进制字符串）。
 * price = (amountOut / 10^decimalsOut) / (amountIn / 10^decimalsIn)
 *       = (amountOut / amountIn) * 10^(decimalsIn - decimalsOut)
 */
export function formatPrice(
  amountIn: bigint,
  decimalsIn: number,
  amountOut: bigint,
  decimalsOut: number,
): string {
  if (amountIn <= 0n) {
    return '0';
  }
  const diff = decimalsIn - decimalsOut;
  if (diff >= 0) {
    return formatFraction(amountOut * 10n ** BigInt(diff), amountIn, 18);
  }
  return formatFraction(amountOut, amountIn * 10n ** BigInt(-diff), 18);
}

/** 十进制字符串 -> 定点 BigInt（scale 位小数），支持负数。如 "0.006" -> 6*10^(scale-3)。 */
export function parseDecimal(s: string, scale = 18n): bigint {
  const t = s.trim();
  const neg = t.startsWith('-');
  const abs = neg ? t.slice(1) : t;
  const [intPart, fracPart = ''] = abs.split('.');
  const intScaled = BigInt(intPart || '0') * 10n ** scale;
  const fracStr = (fracPart || '').padEnd(Number(scale), '0').slice(0, Number(scale));
  const frac = fracStr ? BigInt(fracStr) : 0n;
  const v = intScaled + frac;
  return neg ? -v : v;
}

/**
 * 组合多跳路径的逐跳价格影响：
 *   combined = 1 - ∏(1 - pi_i)
 * 比简单相加更精确（去掉了交叉项），全部 BigInt 定点运算。
 */
export function combinePriceImpacts(impacts: string[]): string {
  const scale = 18n;
  const one = 10n ** scale;
  let acc = one;
  for (const s of impacts) {
    const p = parseDecimal(s, scale);
    if (p < 0n || p > one) {
      continue;
    }
    acc = (acc * (one - p)) / one;
  }
  const combined = one - acc;
  if (combined <= 0n) {
    return '0';
  }
  return formatUnits(combined.toString(), 18);
}
