/**
 * 交易 calldata 构造（Swap 执行的核心合约活）。
 *
 * 原则：
 * - 只构造「协议原生 Router」的 calldata（classic Router / CL SwapRouter），
 *   不实现自定义 Executor（属可选后续 Sprint）。
 * - 用 viem encodeFunctionData 做 ABI 编码，绝不手搓 hex 拼接（避免字节序错误）。
 * - 每个函数都返回 selector，便于用 cast 反解 / 4byte 校验（见 scripts/verify-swap.ts）。
 * - 金额一律「链上原始大整数」字符串；deadline 是 unix 秒（uint256）。
 * - 非托管：这里只产出 calldata 供前端钱包签名广播，后端绝不接触私钥。
 */
import { encodeFunctionData, erc20Abi } from 'viem';
import {
  aerodromeClassicRouterAbi,
  aerodromeSwapRouterAbi,
} from './aerodrome/abis';
import {
  AERODROME_CLASSIC_FACTORY,
  AERODROME_CLASSIC_ROUTER,
  AERODROME_SWAP_ROUTER,
} from './aerodrome/constants';

/** classic Router 的 Route 结构体（Velodrome v2 / Solidly 风格）。 */
export interface ClassicRoute {
  /** 输入 token（小写）。 */
  from: string;
  /** 输出 token（小写）。 */
  to: string;
  /** 是否 stable 池。 */
  stable: boolean;
  /** classic PoolFactory 地址。 */
  factory: string;
}

/** 构造结果：前端直接拿 to/value/data 组装交易。 */
export interface BuiltTransaction {
  /** 目标合约（Router）地址（小写）。 */
  to: string;
  /** 随交易附带的原生 ETH（wei 字符串），ERC20→ERC20 恒为 "0"。 */
  value: string;
  /** 完整 calldata hex（0x 开头）。 */
  data: string;
  /** 调用的函数名。 */
  functionName: string;
  /** 4 字节 selector（0x 开头）。 */
  selector: string;
}

/** classic swapExactTokensForTokens 入参。 */
export interface ClassicSwapTokensParams {
  amountIn: string;
  amountOutMin: string;
  routes: ClassicRoute[];
  recipient: string;
  deadline: number;
}

/** CL exactInputSingle 入参。 */
export interface ClExactInputSingleParams {
  tokenIn: string;
  tokenOut: string;
  /** int24 tickSpacing（Slipstream 池维度，非 Uniswap V3 的 fee）。 */
  tickSpacing: number;
  recipient: string;
  deadline: number;
  amountIn: string;
  amountOutMinimum: string;
  /** uint160 价格上限，0 表示不设限。 */
  sqrtPriceLimitX96?: string;
}

/** CL exactInput（多跳 bytes path）入参。 */
export interface ClExactInputParams {
  /** 已编码的 bytes path（token + tickSpacing 交替）。 */
  path: string;
  recipient: string;
  deadline: number;
  amountIn: string;
  amountOutMinimum: string;
}

/** 从 calldata 提取 4 字节 selector。 */
export function selectorOf(data: string): string {
  return data.slice(0, 10).toLowerCase();
}

function toAddr(a: string): `0x${string}` {
  return a as `0x${string}`;
}

/**
 * classic：ERC20 → ERC20（单跳或多跳 classic 池）。
 * 用 swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)。
 * selector = 0xcac88ea9（已链上核验）。
 */
export function buildClassicSwapExactTokensForTokens(
  p: ClassicSwapTokensParams,
): BuiltTransaction {
  const data = encodeFunctionData({
    abi: aerodromeClassicRouterAbi,
    functionName: 'swapExactTokensForTokens',
    args: [
      BigInt(p.amountIn),
      BigInt(p.amountOutMin),
      p.routes.map((r) => ({
        from: toAddr(r.from),
        to: toAddr(r.to),
        stable: r.stable,
        factory: toAddr(r.factory),
      })),
      toAddr(p.recipient),
      BigInt(p.deadline),
    ],
  });
  return {
    to: AERODROME_CLASSIC_ROUTER.toLowerCase(),
    value: '0',
    data,
    functionName: 'swapExactTokensForTokens',
    selector: selectorOf(data),
  };
}

/**
 * classic：原生 ETH → ERC20（单跳或多跳 classic 池）。
 * 用 swapExactETHForTokens(uint256,(address,address,bool,address)[],address,uint256)（payable）。
 * selector = 0x903638a4（已链上核验）。
 * 注意：msg.value = amountIn，由前端钱包附带；后端不广播。
 */
export function buildClassicSwapExactETHForTokens(p: {
  amountOutMin: string;
  routes: ClassicRoute[];
  recipient: string;
  deadline: number;
  /** 随交易附带的 ETH 数量（wei 字符串）。 */
  value: string;
}): BuiltTransaction {
  const data = encodeFunctionData({
    abi: aerodromeClassicRouterAbi,
    functionName: 'swapExactETHForTokens',
    args: [
      BigInt(p.amountOutMin),
      p.routes.map((r) => ({
        from: toAddr(r.from),
        to: toAddr(r.to),
        stable: r.stable,
        factory: toAddr(r.factory),
      })),
      toAddr(p.recipient),
      BigInt(p.deadline),
    ],
  });
  return {
    to: AERODROME_CLASSIC_ROUTER.toLowerCase(),
    value: p.value,
    data,
    functionName: 'swapExactETHForTokens',
    selector: selectorOf(data),
  };
}

/**
 * classic：ERC20 → 原生 ETH（单跳或多跳 classic 池，最后换成 WETH 再 unwrap）。
 * 用 swapExactTokensForETH(uint256,uint256,(address,address,bool,address)[],address,uint256)。
 * selector = 0xc6b7f1b6（已链上核验）。
 */
export function buildClassicSwapExactTokensForETH(
  p: ClassicSwapTokensParams,
): BuiltTransaction {
  const data = encodeFunctionData({
    abi: aerodromeClassicRouterAbi,
    functionName: 'swapExactTokensForETH',
    args: [
      BigInt(p.amountIn),
      BigInt(p.amountOutMin),
      p.routes.map((r) => ({
        from: toAddr(r.from),
        to: toAddr(r.to),
        stable: r.stable,
        factory: toAddr(r.factory),
      })),
      toAddr(p.recipient),
      BigInt(p.deadline),
    ],
  });
  return {
    to: AERODROME_CLASSIC_ROUTER.toLowerCase(),
    value: '0',
    data,
    functionName: 'swapExactTokensForETH',
    selector: selectorOf(data),
  };
}

/**
 * CL：单跳集中流动性交易。
 * 用 exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))。
 * selector = 0xa026383e（已链上核验，Slipstream 用 int24 tickSpacing）。
 */
export function buildClExactInputSingle(
  p: ClExactInputSingleParams,
): BuiltTransaction {
  const data = encodeFunctionData({
    abi: aerodromeSwapRouterAbi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: toAddr(p.tokenIn),
        tokenOut: toAddr(p.tokenOut),
        tickSpacing: p.tickSpacing,
        recipient: toAddr(p.recipient),
        deadline: BigInt(p.deadline),
        amountIn: BigInt(p.amountIn),
        amountOutMinimum: BigInt(p.amountOutMinimum),
        sqrtPriceLimitX96: BigInt(p.sqrtPriceLimitX96 ?? '0'),
      },
    ],
  });
  return {
    to: AERODROME_SWAP_ROUTER.toLowerCase(),
    value: '0',
    data,
    functionName: 'exactInputSingle',
    selector: selectorOf(data),
  };
}

/**
 * CL：多跳集中流动性交易（bytes path）。
 * 用 exactInput((bytes,address,uint256,uint256,uint256))。
 * selector = 0xc04b8d59（已链上核验）。
 */
export function buildClExactInput(p: ClExactInputParams): BuiltTransaction {
  const data = encodeFunctionData({
    abi: aerodromeSwapRouterAbi,
    functionName: 'exactInput',
    args: [
      {
        path: p.path as `0x${string}`,
        recipient: toAddr(p.recipient),
        deadline: BigInt(p.deadline),
        amountIn: BigInt(p.amountIn),
        amountOutMinimum: BigInt(p.amountOutMinimum),
      },
    ],
  });
  return {
    to: AERODROME_SWAP_ROUTER.toLowerCase(),
    value: '0',
    data,
    functionName: 'exactInput',
    selector: selectorOf(data),
  };
}

/**
 * CL 多跳 bytes path 编码（Slipstream Path.sol 布局）。
 *
 *   token0(20B) + tickSpacing0(3B) + token1(20B) + tickSpacing1(3B) + token2(20B) + ...
 *
 * 与 Uniswap V3 一致，只是 3 字节池维度是 int24 tickSpacing（不是 uint24 fee）。
 * tickSpacing 在 Slipstream 中恒为正，按 3 字节大端编码。
 */
export function encodeClPath(
  hops: { tokenIn: string; tokenOut: string; tickSpacing: number }[],
): string {
  if (hops.length === 0) {
    throw new Error('encodeClPath: hops 不能为空');
  }
  const strip = (a: string): string => a.toLowerCase().replace(/^0x/, '');
  let hex = strip(hops[0].tokenIn);
  for (const h of hops) {
    if (!Number.isInteger(h.tickSpacing) || h.tickSpacing < -8_388_608 || h.tickSpacing > 8_388_607) {
      throw new Error(`encodeClPath: 非法 tickSpacing=${h.tickSpacing}（超出 int24 范围）`);
    }
    const ts = BigInt(h.tickSpacing) & 0xffffffn;
    hex += ts.toString(16).padStart(6, '0');
    hex += strip(h.tokenOut);
  }
  return `0x${hex}`;
}

/** 构造 ERC20 approve calldata（spender 只授权本次所需额度 amount）。 */
export function buildApproveCalldata(params: {
  spender: string;
  amount: string;
}): BuiltTransaction {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [toAddr(params.spender), BigInt(params.amount)],
  });
  return {
    to: '', // approve 的目标是 token 合约本身，由调用方填充
    value: '0',
    data,
    functionName: 'approve',
    selector: selectorOf(data),
  };
}

/** classic Route 的默认 factory（classic PoolFactory）。 */
export function classicRoute(
  from: string,
  to: string,
  stable: boolean,
  factory: string = AERODROME_CLASSIC_FACTORY,
): ClassicRoute {
  return { from: from.toLowerCase(), to: to.toLowerCase(), stable, factory: factory.toLowerCase() };
}
