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

/** 费率基准：1e6 = 100%（ppm）。 */
const PPM = 1_000_000n;

/**
 * 恒定乘积（x*y=k）池：反解「价格影响 ≤ 阈值」前提下的最大可输入金额。
 *
 * 价格影响关于 amountIn 单调不减（见下方推导），因此可解析反解，无需二分 RPC：
 *
 *   amountInWithFee = amountIn * (1e6 - feePpm) / 1e6
 *   amountOut       = reserveOut * amountInWithFee / (reserveIn + amountInWithFee)
 *   priceImpact     = 1 - (amountOut / amountIn) / (reserveOut / reserveIn)
 *                   = (reserveIn*feePpm + F*amountIn) / (reserveIn*1e6 + F*amountIn)
 *   其中 F = 1e6 - feePpm
 *
 *   令 priceImpact ≤ thr（thr 为定点 BigInt，scale 位小数），解出：
 *     amountIn ≤ reserveIn * (thr*1e6 - feePpm*10^scale) / (F * (10^scale - thr))
 *
 * 返回最大整数值（向下取整）。当阈值 ≤ 池子费率（feePpm/1e6，即 amountIn=0 时的
 * 价格影响）时，任何金额都超标，返回 0。
 *
 * 注意：本函数对应「无 floor 的精确除法」模型。实际 `getAmountOutConstantProduct`
 * 有两处整数 floor 会令真实价格影响略高（真实 cap 略小）。调用方如需与真实二分
 * 结果逐 bit 一致，应以本结果作上界再用纯函数做一次本地微调。
 *
 * @param reserveIn 输入 token 的储备量（链上原始大整数）
 * @param feePpm    池子费率（ppm，1_000_000 = 100%）
 * @param threshold 价格影响阈值（定点 BigInt，scale 位小数，如 0.01 → 10^(scale-2)）
 * @param scale     定点小数位数（与 parseDecimal 一致，默认 18）
 */
export function maxAmountInConstantProduct(params: {
  reserveIn: bigint;
  feePpm: bigint;
  threshold: bigint;
  scale?: bigint;
}): bigint {
  const { reserveIn, feePpm, threshold } = params;
  const scale = params.scale ?? 18n;
  if (reserveIn <= 0n) {
    return 0n;
  }
  if (feePpm < 0n || feePpm >= PPM) {
    return 0n;
  }
  if (threshold <= 0n) {
    return 0n;
  }
  const one = 10n ** scale;
  const f = PPM - feePpm; // = 1e6 - feePpm
  // 阈值需超过「零输入时的价格影响」= feePpm / 1e6，否则任何金额都超标
  const num = reserveIn * (threshold * PPM - feePpm * one);
  if (num <= 0n) {
    return 0n;
  }
  const den = f * (one - threshold);
  if (den <= 0n) {
    return 0n;
  }
  return num / den;
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

/** Solidly stableswap 曲线（x³y + xy³ = k）的 1e18 定点基准。 */
const WAD = 10n ** 18n;

/**
 * Solidly stableswap（x³y + xy³ = k）曲线报价。
 *
 * 与 Velodrome v2 / Aerodrome classic stable 池的链上 `Pool.getAmountOut` stable
 * 分支逐 bit 一致：严格复刻 Solidity 的整数运算（BigInt 除法 = 向下取整 floor，
 * 乘法 / 括号顺序照抄，禁止重排——重排会改变 floor 结果）。所有中间量按 1e18 定点。
 *
 * 返回 null 表示链上等价 revert：
 * - `_get_y` 255 轮整数牛顿迭代不收敛（链上 `revert("!y")`）；
 * - 中间下溢（如 `reserveB - y < 0`、`y - dy < 0`）或 `_d` 为 0（除零）。
 *
 * 纯函数：reserve/amountIn 为链上原始大整数；feeBps 为链上 bps（stable 池通常 5 =
 * 0.05%）；decimals0/decimals1 为 token decimals，由调用方显式解析后传入。
 *
 * @param reserve0 token0 储备（链上原始整数）
 * @param reserve1 token1 储备（链上原始整数）
 * @param amountIn 输入金额（链上原始整数，未扣费）
 * @param tokenInIsToken0 tokenIn 是否即 token0
 * @param decimals0 token0 decimals
 * @param decimals1 token1 decimals
 * @param feeBps 链上费率 bps（如 5）
 */
export function getAmountOutSolidlyStable(params: {
  reserve0: bigint;
  reserve1: bigint;
  amountIn: bigint;
  tokenInIsToken0: boolean;
  decimals0: number;
  decimals1: number;
  feeBps: bigint;
}): bigint | null {
  const {
    reserve0,
    reserve1,
    amountIn,
    tokenInIsToken0,
    decimals0,
    decimals1,
    feeBps,
  } = params;
  if (amountIn <= 0n || reserve0 <= 0n || reserve1 <= 0n) {
    return null;
  }
  if (
    !Number.isInteger(decimals0) ||
    decimals0 < 0 ||
    !Number.isInteger(decimals1) ||
    decimals1 < 0
  ) {
    return null;
  }
  if (feeBps < 0n) {
    return null;
  }

  // 扣费（链上：amountIn -= amountIn * feeBps / 10000）
  const amountInNet = amountIn - (amountIn * feeBps) / 10_000n;
  if (amountInNet <= 0n) {
    return 0n;
  }

  const xy = kSolidlyStable(reserve0, reserve1, decimals0, decimals1);
  const r0n = (reserve0 * WAD) / 10n ** BigInt(decimals0);
  const r1n = (reserve1 * WAD) / 10n ** BigInt(decimals1);

  const reserveA = tokenInIsToken0 ? r0n : r1n;
  const reserveB = tokenInIsToken0 ? r1n : r0n;
  const amountInNorm =
    (amountInNet * WAD) / 10n ** BigInt(tokenInIsToken0 ? decimals0 : decimals1);

  const y = getYSolidlyStable(amountInNorm + reserveA, xy, reserveB);
  if (y === null || y > reserveB) {
    return null;
  }
  const amountOutNorm = reserveB - y;
  const decimalsOut = tokenInIsToken0 ? decimals1 : decimals0;
  return (amountOutNorm * 10n ** BigInt(decimalsOut)) / WAD;
}

/** Solidly `_k(x, y)`：按 decimals 归一化后计算不变式（stable 分支）。 */
function kSolidlyStable(
  x: bigint,
  y: bigint,
  decimals0: number,
  decimals1: number,
): bigint {
  const _x = (x * WAD) / 10n ** BigInt(decimals0);
  const _y = (y * WAD) / 10n ** BigInt(decimals1);
  const _a = (_x * _y) / WAD;
  const _b = (_x * _x) / WAD + (_y * _y) / WAD;
  return (_a * _b) / WAD;
}

/** Solidly `_f(x0, y)`：x0³y + x0·y³ 的定点实现。 */
function fSolidlyStable(x0: bigint, y: bigint): bigint {
  const _a = (x0 * y) / WAD;
  const _b = (x0 * x0) / WAD + (y * y) / WAD;
  return (_a * _b) / WAD;
}

/** Solidly `_d(x0, y)`：_f 对 y 的偏导（定点）。括号顺序严格照抄链上。 */
function dSolidlyStable(x0: bigint, y: bigint): bigint {
  // ((3 * x0) * (y²/1e18)) / 1e18 + (((x0²/1e18) * x0) / 1e18)
  return (3n * x0 * ((y * y) / WAD)) / WAD + (((x0 * x0) / WAD) * x0) / WAD;
}

/**
 * Solidly `_get_y(x0, xy, y)`：整数牛顿迭代解 x0³y + x0·y³ = xy 中的 y。
 * 255 轮不收敛返回 null（等价链上 revert("!y")）；中间下溢 / 除零也返回 null。
 */
function getYSolidlyStable(x0: bigint, xy: bigint, y: bigint): bigint | null {
  for (let i = 0; i < 255; i++) {
    const k = fSolidlyStable(x0, y);
    const d = dSolidlyStable(x0, y);
    if (d <= 0n) {
      return null;
    }
    if (k < xy) {
      let dy = ((xy - k) * WAD) / d;
      if (dy === 0n) {
        if (k === xy) {
          return y;
        }
        if (fSolidlyStable(x0, y + 1n) > xy) {
          return y + 1n;
        }
        dy = 1n;
      }
      y = y + dy;
    } else {
      let dy = ((k - xy) * WAD) / d;
      if (dy === 0n) {
        if (k === xy) {
          return y;
        }
        if (y - 1n < 0n) {
          return null; // 等价 Solidity 0.8 的 y-1 下溢 revert
        }
        if (fSolidlyStable(x0, y - 1n) < xy) {
          return y;
        }
        dy = 1n;
      }
      if (dy > y) {
        return null; // 等价 Solidity 0.8 的 y-dy 下溢 revert
      }
      y = y - dy;
    }
  }
  return null; // 255 轮不收敛（链上 revert("!y")）
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
