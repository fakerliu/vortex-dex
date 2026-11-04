/**
 * swap_events.event_data 解析与方向推导（Sprint 8 交易记录用）。
 *
 * Indexer（Sprint 7）把标准化事件以 JSON 字符串写入 swap_events.event_data：
 * - CL（Slipstream，Uniswap v3 fork）Swap：{ sender, recipient, amount0(int256), amount1(int256), ... }
 * - classic（Velodrome v2 fork）Swap：{ sender, to, amount0In, amount1In, amount0Out, amount1Out, ... }
 *
 * 本文件把两种事件统一成可推导交易方向的结构，供 User/Swap 模块共用。
 */

/** 统一解析结构（金额一律字符串；地址一律小写）。 */
export interface ParsedSwapEventData {
  pool: string;
  poolId: string;
  family: 'classic' | 'cl';
  protocolType: string;
  sender: string | null;
  /** CL 用 recipient，classic 用 to，统一到 recipient。 */
  recipient: string | null;
  amount0In: string | null;
  amount1In: string | null;
  amount0Out: string | null;
  amount1Out: string | null;
  /** CL 有符号金额（正数=流入池子=用户付出，负数=流出池子=用户收到）。 */
  amount0: string | null;
  amount1: string | null;
  blockHash: string | null;
}

export interface SwapDirection {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
}

function emptyParsed(): ParsedSwapEventData {
  return {
    pool: '',
    poolId: '',
    family: 'classic',
    protocolType: '',
    sender: null,
    recipient: null,
    amount0In: null,
    amount1In: null,
    amount0Out: null,
    amount1Out: null,
    amount0: null,
    amount1: null,
    blockHash: null,
  };
}

/** 解析 event_data JSON（容错：解析失败返回空结构）。 */
export function parseSwapEventData(eventData: string): ParsedSwapEventData {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(eventData) as Record<string, unknown>;
  } catch {
    return emptyParsed();
  }

  const str = (key: string): string | null => {
    const v = raw[key];
    if (typeof v === 'string') {
      return v;
    }
    return v === undefined || v === null ? null : String(v);
  };
  const lowerOrNull = (key: string): string | null => {
    const s = str(key);
    return s === null ? null : s.toLowerCase();
  };

  return {
    pool: str('pool') ?? '',
    poolId: str('poolId') ?? '',
    family: raw.family === 'cl' ? 'cl' : 'classic',
    protocolType: str('protocolType') ?? '',
    sender: lowerOrNull('sender'),
    recipient: lowerOrNull('recipient') ?? lowerOrNull('to'),
    amount0In: str('amount0In'),
    amount1In: str('amount1In'),
    amount0Out: str('amount0Out'),
    amount1Out: str('amount1Out'),
    amount0: str('amount0'),
    amount1: str('amount1'),
    blockHash: str('blockHash'),
  };
}

/** 判断地址是否为该 Swap 事件的参与者（sender 或 recipient/to）。 */
export function swapEventHasParticipant(
  ev: ParsedSwapEventData,
  address: string,
): boolean {
  return ev.sender === address || ev.recipient === address;
}

/**
 * 由事件 + 池子 token0/token1 推导交易方向。
 *
 * CL（Uniswap v3 fork）：amount0/amount1 为有符号 int256。
 *   正=流入池子（用户付出该 token），负=流出池子（用户收到该 token）。
 *   amount0>0 & amount1<0 → token0→token1；amount1>0 & amount0<0 → token1→token0。
 * classic：单向 Swap，amountXIn/amountYOut 成对出现。
 * 无法推导（如 amount 缺失或方向异常）时返回 null。
 */
export function deriveSwapDirection(
  ev: ParsedSwapEventData,
  token0: string,
  token1: string,
): SwapDirection | null {
  if (!token0 || !token1) {
    return null;
  }

  if (ev.family === 'cl') {
    if (ev.amount0 === null || ev.amount1 === null) {
      return null;
    }
    const a0 = BigInt(ev.amount0);
    const a1 = BigInt(ev.amount1);
    if (a0 > 0n && a1 < 0n) {
      return {
        tokenIn: token0,
        tokenOut: token1,
        amountIn: a0.toString(),
        amountOut: (-a1).toString(),
      };
    }
    if (a1 > 0n && a0 < 0n) {
      return {
        tokenIn: token1,
        tokenOut: token0,
        amountIn: a1.toString(),
        amountOut: (-a0).toString(),
      };
    }
    return null;
  }

  const a0In = ev.amount0In ? BigInt(ev.amount0In) : 0n;
  const a1In = ev.amount1In ? BigInt(ev.amount1In) : 0n;
  const a0Out = ev.amount0Out ? BigInt(ev.amount0Out) : 0n;
  const a1Out = ev.amount1Out ? BigInt(ev.amount1Out) : 0n;

  if (a0In > 0n && a1Out > 0n) {
    return {
      tokenIn: token0,
      tokenOut: token1,
      amountIn: a0In.toString(),
      amountOut: a1Out.toString(),
    };
  }
  if (a1In > 0n && a0Out > 0n) {
    return {
      tokenIn: token1,
      tokenOut: token0,
      amountIn: a1In.toString(),
      amountOut: a0Out.toString(),
    };
  }
  return null;
}
