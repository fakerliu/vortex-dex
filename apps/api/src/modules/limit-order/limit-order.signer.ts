import {
  decodeFunctionData,
  erc20Abi,
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { parseDecimal } from '../../dex/math';
import {
  buildClassicSwapExactTokensForTokens,
  buildClExactInput,
  buildClExactInputSingle,
  buildUniswapV3ExactInput,
  buildUniswapV3ExactInputSingle,
  classicRoute,
  encodeClPath,
  encodeUniswapV3Path,
  type BuiltTransaction,
} from '../../dex/calldata';
import {
  aerodromeClassicRouterAbi,
  aerodromeSwapRouterAbi,
} from '../../dex/aerodrome/abis';
import {
  AERODROME_CLASSIC_ROUTER,
  AERODROME_PROTOCOL_TYPE_CL,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
  AERODROME_SWAP_ROUTER,
} from '../../dex/aerodrome/constants';
import { uniswapV3SwapRouterAbi } from '../../dex/uniswap-v3/abis';
import {
  UNISWAP_V3_PROTOCOL_TYPE,
  UNISWAP_V3_SWAP_ROUTER,
} from '../../dex/uniswap-v3/constants';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
} from '../../chain/chain.constants';
import type { SwapHopDto } from '../swap/swap.types';

/**
 * 限价单签名域（Phase 1 用户预签 + keeper 广播）纯函数工具。
 *
 * 只做「组装待签交易」与「校验已签交易」两件事：
 * - buildSwapTransaction：按 prepare 返回的 hops 重建 swap calldata，
 *   amountOutMin = min_amount_out（限价），deadline = expires_at，recipient = user。
 * - verifySignedSwap / verifySignedApproval：recover 地址 + 比对 calldata 关键字段。
 * 本文件绝不接触任何私钥，只解析 raw hex（公开字节）。
 */

const SCALE_18 = 18n;

/** 各链允许作为 swap 目标的 Router（授权对象）白名单。 */
const SWAP_ROUTERS_BY_CHAIN: Record<number, Set<string>> = {
  [BASE_MAINNET_CHAIN_ID]: new Set([
    AERODROME_CLASSIC_ROUTER.toLowerCase(),
    AERODROME_SWAP_ROUTER.toLowerCase(),
  ]),
  [BASE_SEPOLIA_CHAIN_ID]: new Set([
    UNISWAP_V3_SWAP_ROUTER.toLowerCase(),
  ]),
};

/** 已签名交易的序列化类型（parseTransaction / recoverTransactionAddress 的入参）。 */
type SerializedTransaction = Parameters<typeof parseTransaction>[0];

/** parseTransaction 后实际使用到的字段（签名交易的 calldata 字段名为 data）。 */
interface ParsedSignedTx {
  to: string | null;
  data: string;
  value: bigint | undefined; // viem 对 value=0 的序列化（0x）不会回填该字段
  chainId: number;
}

/** 从 swap calldata 反解出的关键字段。 */
export interface DecodedSwapFields {
  selector: string;
  amountIn: bigint;
  amountOutMin: bigint;
  recipient: string;
  deadline: bigint;
}

/**
 * 派生 min_amount_out（权威限价，BigInt floor，禁 Float，架构 §3.3）：
 *   min_amount_out = floor( amount_in × 10^decimalsOut × 10^18 / ( limit_price_scaled × 10^decimalsIn ) )
 * 其中 limit_price_scaled = parseDecimal(limit_price, 18)。
 */
export function deriveMinAmountOut(
  amountIn: bigint,
  limitPrice: string,
  decimalsIn: number,
  decimalsOut: number,
): bigint {
  if (amountIn <= 0n) {
    throw new Error('amountIn 必须大于 0');
  }
  const limitPriceScaled = parseDecimal(limitPrice, SCALE_18);
  if (limitPriceScaled <= 0n) {
    throw new Error('limitPrice 必须大于 0');
  }
  const numerator =
    amountIn * (10n ** BigInt(decimalsOut)) * (10n ** SCALE_18);
  const denominator = limitPriceScaled * (10n ** BigInt(decimalsIn));
  if (denominator <= 0n) {
    throw new Error('limitPrice 非法（分母为 0）');
  }
  // BigInt 除法对正数即 floor（向下取整）。
  return numerator / denominator;
}

/**
 * 按 hops 重建限价单成交交易的 calldata。
 * 与 SwapService.buildTransaction 同逻辑，但 amountOutMin / deadline 由限价单语义注入。
 */
export function buildSwapTransaction(
  hops: SwapHopDto[],
  recipient: string,
  amountIn: string,
  amountOutMin: string,
  deadline: number,
  sqrtPriceLimitX96?: string,
): BuiltTransaction {
  const allClassic = hops.every(
    (h) => h.protocol === AERODROME_PROTOCOL_TYPE_CLASSIC,
  );
  const allCl = hops.every((h) => h.protocol === AERODROME_PROTOCOL_TYPE_CL);
  const allUniswapV3 = hops.every(
    (h) => h.protocol === UNISWAP_V3_PROTOCOL_TYPE,
  );

  if (allClassic) {
    const routes = hops.map((h) =>
      classicRoute(h.tokenIn, h.tokenOut, h.stable ?? false),
    );
    return buildClassicSwapExactTokensForTokens({
      amountIn,
      amountOutMin,
      routes,
      recipient,
      deadline,
    });
  }

  if (allCl) {
    if (hops.length === 1) {
      const h = hops[0];
      return buildClExactInputSingle({
        tokenIn: h.tokenIn,
        tokenOut: h.tokenOut,
        tickSpacing: h.tickSpacing ?? 0,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96,
      });
    }
    const path = encodeClPath(
      hops.map((h) => ({
        tokenIn: h.tokenIn,
        tokenOut: h.tokenOut,
        tickSpacing: h.tickSpacing ?? 0,
      })),
    );
    return buildClExactInput({
      path,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum: amountOutMin,
    });
  }

  if (allUniswapV3) {
    if (hops.length === 1) {
      const h = hops[0];
      return buildUniswapV3ExactInputSingle({
        tokenIn: h.tokenIn,
        tokenOut: h.tokenOut,
        fee: Number(h.fee),
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96,
      });
    }
    const path = encodeUniswapV3Path(
      hops.map((h) => ({
        tokenIn: h.tokenIn,
        tokenOut: h.tokenOut,
        fee: Number(h.fee),
      })),
    );
    return buildUniswapV3ExactInput({
      path,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum: amountOutMin,
    });
  }

  throw new Error(
    '暂不支持 classic + CL 混合多跳执行（需 UniversalRouter 或自定义 Executor）',
  );
}

/**
 * 校验用户提交的已签名 swap 交易：
 * recover 地址 === userAddress + chainId + to 是已知 Router + 比对 calldata
 * （amountIn / amountOutMin / recipient / deadline）。
 */
export async function verifySignedSwap(
  rawTx: string,
  expected: {
    chainId: number;
    userAddress: string;
    amountIn: string;
    minAmountOut: string;
    expiresAt: Date;
  },
): Promise<{ to: string; selector: string }> {
  const parsed = parseSignedTx(rawTx);
  await assertRecovered(parsed, rawTx, expected.chainId, expected.userAddress);

  if (!parsed.to) {
    throw new Error('swap 交易缺少目标地址');
  }
  const to = parsed.to.toLowerCase();
  if (!isValidSwapRouter(expected.chainId, to)) {
    throw new Error(`swap 交易目标不是已知 Router: ${to}`);
  }
  if ((parsed.value ?? 0n) !== 0n) {
    throw new Error('swap 交易 value 必须为 0（ERC20→ERC20）');
  }

  const fields = decodeSwapData(expected.chainId, parsed.data);
  if (fields.amountIn !== BigInt(expected.amountIn)) {
    throw new Error('calldata amountIn 与订单不符');
  }
  if (fields.amountOutMin !== BigInt(expected.minAmountOut)) {
    throw new Error('calldata amountOutMin 与订单不符');
  }
  if (fields.recipient !== expected.userAddress) {
    throw new Error('calldata recipient 与订单不符');
  }
  const expectedDeadline = BigInt(
    Math.floor(expected.expiresAt.getTime() / 1000),
  );
  if (fields.deadline !== expectedDeadline) {
    throw new Error('calldata deadline 与订单不符');
  }

  return { to, selector: fields.selector };
}

/**
 * 校验用户提交的已签名 approve 交易：
 * recover 地址 === userAddress + to === tokenIn + spender 是已知 Router + amount >= amountIn。
 */
export async function verifySignedApproval(
  rawTx: string,
  expected: {
    chainId: number;
    userAddress: string;
    tokenIn: string;
    amountIn: string;
  },
): Promise<void> {
  const parsed = parseSignedTx(rawTx);
  await assertRecovered(parsed, rawTx, expected.chainId, expected.userAddress);

  const to = parsed.to?.toLowerCase();
  if (to !== expected.tokenIn) {
    throw new Error('approve 交易目标必须是 tokenIn 合约');
  }
  if ((parsed.value ?? 0n) !== 0n) {
    throw new Error('approve 交易 value 必须为 0');
  }

  const { args } = decodeFunctionData({
    abi: erc20Abi,
    data: parsed.data as Hex,
  });
  const spender = String(args[0]).toLowerCase();
  if (!isValidSwapRouter(expected.chainId, spender)) {
    throw new Error(`approve spender 不是已知 Router: ${spender}`);
  }
  const amount = args[1] as bigint;
  if (amount < BigInt(expected.amountIn)) {
    throw new Error('approve 授权额度不足（小于 amountIn）');
  }
}

/** 反解 swap calldata 关键字段（按 selector + chain 分派 ABI）。 */
export function decodeSwapData(chainId: number, data: string): DecodedSwapFields {
  const selector = data.slice(0, 10).toLowerCase();

  // classic swapExactTokensForTokens(uint256,uint256,Route[],address,uint256)
  if (selector === '0xcac88ea9') {
    const { args } = decodeFunctionData({
      abi: aerodromeClassicRouterAbi,
      data: data as Hex,
    });
    return {
      selector,
      amountIn: args[0] as bigint,
      amountOutMin: args[1] as bigint,
      recipient: String(args[3]).toLowerCase(),
      deadline: args[4] as bigint,
    };
  }

  // Aerodrome CL exactInputSingle((...,int24 tickSpacing,...))
  if (selector === '0xa026383e') {
    const { args } = decodeFunctionData({
      abi: aerodromeSwapRouterAbi,
      data: data as Hex,
    });
    const p = args[0] as {
      recipient: string;
      deadline: bigint;
      amountIn: bigint;
      amountOutMinimum: bigint;
    };
    return {
      selector,
      amountIn: p.amountIn,
      amountOutMin: p.amountOutMinimum,
      recipient: p.recipient.toLowerCase(),
      deadline: p.deadline,
    };
  }

  // Uniswap V3 exactInputSingle((...,uint24 fee,...))
  if (selector === '0x414bf389') {
    const { args } = decodeFunctionData({
      abi: uniswapV3SwapRouterAbi,
      data: data as Hex,
    });
    const p = args[0] as {
      recipient: string;
      deadline: bigint;
      amountIn: bigint;
      amountOutMinimum: bigint;
    };
    return {
      selector,
      amountIn: p.amountIn,
      amountOutMin: p.amountOutMinimum,
      recipient: p.recipient.toLowerCase(),
      deadline: p.deadline,
    };
  }

  // exactInput(bytes path,...)：CL 与 Uniswap V3 同 selector，按 chain 分派。
  if (selector === '0xc04b8d59') {
    const abi =
      chainId === BASE_MAINNET_CHAIN_ID
        ? aerodromeSwapRouterAbi
        : uniswapV3SwapRouterAbi;
    const { args } = decodeFunctionData({ abi, data: data as Hex });
    const p = args[0] as {
      recipient: string;
      deadline: bigint;
      amountIn: bigint;
      amountOutMinimum: bigint;
    };
    return {
      selector,
      amountIn: p.amountIn,
      amountOutMin: p.amountOutMinimum,
      recipient: p.recipient.toLowerCase(),
      deadline: p.deadline,
    };
  }

  throw new Error(`不支持的 swap calldata selector: ${selector}`);
}

/** 从已签名 swap 交易提取目标 Router 地址（keeper 成交前余额/授权复核用）。 */
export function extractSwapTarget(rawTx: string): string {
  const parsed = parseSignedTx(rawTx);
  if (!parsed.to) {
    throw new Error('swap 交易缺少目标地址');
  }
  return parsed.to.toLowerCase();
}

/** 校验 recover 地址 === userAddress 且 chainId 一致（非本人/异链签名直接拒绝）。 */
async function assertRecovered(
  parsed: ParsedSignedTx,
  rawTx: string,
  expectedChainId: number,
  userAddress: string,
): Promise<void> {
  if (parsed.chainId !== expectedChainId) {
    throw new Error(`交易 chainId 与订单不符: ${parsed.chainId}`);
  }
  const recovered = (
    await recoverTransactionAddress({
      serializedTransaction: rawTx as TransactionSerialized,
    })
  ).toLowerCase();
  if (recovered !== userAddress) {
    throw new Error('签名者与 userAddress 不一致');
  }
}

/** 解析已签名交易，提取 to / data / value / chainId。 */
function parseSignedTx(rawTx: string): ParsedSignedTx {
  if (!/^0x[0-9a-fA-F]+$/.test(rawTx)) {
    throw new Error('交易必须是 0x 开头的十六进制');
  }
  return parseTransaction(rawTx as SerializedTransaction) as unknown as ParsedSignedTx;
}

function isValidSwapRouter(chainId: number, address: string): boolean {
  return SWAP_ROUTERS_BY_CHAIN[chainId]?.has(address.toLowerCase()) ?? false;
}
