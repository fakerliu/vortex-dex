import { Injectable } from '@nestjs/common';
import type { PublicClient } from 'viem';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import type { DexAdapter } from '../dex-adapter.interface';
import type {
  GasEstimate,
  Pool,
  PoolState,
  ProtocolInfo,
  QuoteParams,
  QuoteResult,
} from '../types';
import {
  computePriceImpact,
  parseAmount,
  sqrtPriceX96ToMidPrice,
} from '../math';
import {
  callView,
  isZeroAddress,
  toAddress,
} from '../aerodrome/aerodrome.utils';
import {
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
  uniswapV3QuoterAbi,
} from './abis';
import {
  UNISWAP_V3_CHAIN_ID,
  UNISWAP_V3_DEFAULT_GAS_LIMIT,
  UNISWAP_V3_FACTORY,
  UNISWAP_V3_FEE_TIERS,
  UNISWAP_V3_PROTOCOL_TYPE,
  UNISWAP_V3_QUOTER,
  UNISWAP_V3_SWAP_ROUTER,
} from './constants';

/** QuoterV2 quoteExactInputSingle 的完整四元组返回。 */
type QuoteExactInputSingleResult = readonly [
  amountOut: bigint,
  sqrtPriceX96After: bigint,
  initializedTicksCrossed: number,
  gasEstimate: bigint,
];

/** Uniswap V3 slot0 7 元组。 */
type Slot0Result = readonly [
  sqrtPriceX96: bigint,
  tick: number,
  observationIndex: number,
  observationCardinality: number,
  observationCardinalityNext: number,
  feeProtocol: number,
  unlocked: boolean,
];

/**
 * Uniswap V3（Base Sepolia 84532）Adapter。
 *
 * 与 Aerodrome CL 的差异（勿复用其 tickSpacing 逻辑）：
 * - 池维度是 fee（uint24），不是 int24 tickSpacing；池子没有 tickSpacing()。
 * - 报价走官方 QuoterV2 quoteExactInputSingle（params 第 4 字段 uint24 fee）。
 * - slot0 是 7 元组（含 feeProtocol/unlocked）。
 * - 价格影响用 slot0.sqrtPriceX96 推导即期价，做一阶近似（已标注近似）。
 */
@Injectable()
export class UniswapV3Adapter implements DexAdapter {
  constructor(private readonly rpc: ChainRpcService) {}

  async getProtocolInfo(): Promise<ProtocolInfo> {
    return {
      chainId: UNISWAP_V3_CHAIN_ID,
      name: 'Uniswap V3',
      protocolType: UNISWAP_V3_PROTOCOL_TYPE,
      version: 'v3',
      factoryAddress: UNISWAP_V3_FACTORY.toLowerCase(),
      routerAddress: UNISWAP_V3_SWAP_ROUTER.toLowerCase(),
      quoterAddress: UNISWAP_V3_QUOTER.toLowerCase(),
      verified: true,
      verificationSource:
        'Base Sepolia 链上核验：Factory.getPool(WETH,USDC,500) 返回真实池 ' +
        '0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0；SwapRouter02 code 存在 ' +
        '（0x60806040）；QuoterV2 code 存在（含 factory() selector c45a0155）',
    };
  }

  async discoverPools(tokenA: string, tokenB: string): Promise<Pool[]> {
    const a = toAddress(tokenA, 'tokenA');
    const b = toAddress(tokenB, 'tokenB');
    const client = this.client();
    const factory = UNISWAP_V3_FACTORY as `0x${string}`;

    const pools: Pool[] = [];
    for (const fee of UNISWAP_V3_FEE_TIERS) {
      const addr = await callView<string>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: factory,
        abi: uniswapV3FactoryAbi,
        functionName: 'getPool',
        args: [a, b, fee],
        label: `Uniswap V3 factory getPool(${a}, ${b}, ${fee})`,
      });
      if (isZeroAddress(addr)) {
        continue;
      }
      pools.push(await this.buildPool(addr, fee));
    }
    return pools;
  }

  async getPoolState(poolAddress: string): Promise<PoolState> {
    const addr = toAddress(poolAddress, 'poolAddress');
    return this.readCore(this.client(), addr);
  }

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const poolAddress = toAddress(params.poolAddress, 'poolAddress');
    const tokenIn = toAddress(params.tokenIn, 'tokenIn');
    const tokenOut = toAddress(params.tokenOut, 'tokenOut');
    const amountIn = parseAmount(params.amountIn);
    if (amountIn <= 0n) {
      throw new Error(`amountIn 必须为正数: ${params.amountIn}`);
    }
    const sqrtPriceLimitX96 = params.sqrtPriceLimitX96
      ? parseAmount(params.sqrtPriceLimitX96)
      : 0n;

    const client = this.client();
    const state = await this.readCore(client, poolAddress);

    // 校验方向
    const tokenInIsToken0 = this.resolveDirection(state, tokenIn, tokenOut);

    // 官方 QuoterV2 报价（CL 集中流动性，不用 V2 公式）
    const res = await callView<QuoteExactInputSingleResult>({
      client,
      chainId: UNISWAP_V3_CHAIN_ID,
      address: UNISWAP_V3_QUOTER as `0x${string}`,
      abi: uniswapV3QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          amountIn,
          fee: Number(state.fee),
          sqrtPriceLimitX96,
        },
      ],
      label: `Uniswap V3 Quoter.quoteExactInputSingle(${tokenIn}->${tokenOut}, ${amountIn}, fee=${state.fee})`,
    });

    const amountOut = res[0];

    // 价格影响一阶近似（基于 slot0 即期价）
    const sqrtPriceX96 = BigInt(state.sqrtPriceX96 ?? '0');
    const mid = sqrtPriceX96ToMidPrice(sqrtPriceX96, tokenInIsToken0);
    const priceImpact = computePriceImpact({
      amountIn,
      amountOut,
      midNum: mid.midNum,
      midDen: mid.midDen,
    });

    return {
      chainId: UNISWAP_V3_CHAIN_ID,
      poolAddress,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      kind: 'cl',
      fee: state.fee,
      priceImpact,
      source: 'quoter',
      route: [{ pool: poolAddress, kind: 'cl' }],
      gasEstimate: res[3].toString(),
    };
  }

  async estimateGas(params: QuoteParams): Promise<GasEstimate> {
    // 复用 Quoter 内部 swap 仿真的 gasEstimate（比静态值更接近真实）。
    try {
      const poolAddress = toAddress(params.poolAddress, 'poolAddress');
      const tokenIn = toAddress(params.tokenIn, 'tokenIn');
      const tokenOut = toAddress(params.tokenOut, 'tokenOut');
      const amountIn = parseAmount(params.amountIn);
      const sqrtPriceLimitX96 = params.sqrtPriceLimitX96
        ? parseAmount(params.sqrtPriceLimitX96)
        : 0n;
      const client = this.client();
      const state = await this.readCore(client, poolAddress);
      const res = await callView<QuoteExactInputSingleResult>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: UNISWAP_V3_QUOTER as `0x${string}`,
        abi: uniswapV3QuoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            amountIn,
            fee: Number(state.fee),
            sqrtPriceLimitX96,
          },
        ],
        label: 'Uniswap V3 Quoter.quoteExactInputSingle (estimateGas)',
      });
      return {
        gasLimit: res[3].toString(),
        source: 'quoter-simulation',
        estimated: true,
        note: '来自 QuoterV2 内部 swap 仿真的 gasEstimate',
      };
    } catch {
      return {
        gasLimit: UNISWAP_V3_DEFAULT_GAS_LIMIT.toString(),
        source: 'static',
        estimated: true,
        note: 'Quoter 仿真失败，降级为静态估算值',
      };
    }
  }

  // ---------- 私有 ----------

  private client(): PublicClient {
    return this.rpc.getClient(UNISWAP_V3_CHAIN_ID);
  }

  private async buildPool(address: string, fee: number): Promise<Pool> {
    const addr = address as `0x${string}`;
    const client = this.client();
    const [token0, token1, feeOnchain] = await Promise.all([
      callView<string>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'token0',
        label: 'Uniswap V3 pool token0()',
      }),
      callView<string>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'token1',
        label: 'Uniswap V3 pool token1()',
      }),
      callView<number>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'fee',
        label: 'Uniswap V3 pool fee()',
      }),
    ]);

    // fee 已是 ppm（uint24，3000 = 0.30%），feeRaw 同源。
    const feePpm = BigInt(feeOnchain).toString();
    return {
      chainId: UNISWAP_V3_CHAIN_ID,
      address: addr,
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      kind: 'cl',
      fee: feePpm,
      feeRaw: feePpm,
    };
  }

  /** 读取 Uniswap V3 池子核心状态（token0/token1/fee/liquidity/slot0[7元组]）。 */
  private async readCore(
    client: PublicClient,
    addr: `0x${string}`,
  ): Promise<PoolState> {
    const [token0, token1, fee, liquidity, slot0] = await Promise.all([
      callView<string>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'token0',
        label: 'Uniswap V3 pool token0()',
      }),
      callView<string>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'token1',
        label: 'Uniswap V3 pool token1()',
      }),
      callView<number>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'fee',
        label: 'Uniswap V3 pool fee()',
      }),
      callView<bigint>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'liquidity',
        label: 'Uniswap V3 pool liquidity()',
      }),
      callView<Slot0Result>({
        client,
        chainId: UNISWAP_V3_CHAIN_ID,
        address: addr,
        abi: uniswapV3PoolAbi,
        functionName: 'slot0',
        label: 'Uniswap V3 pool slot0()',
      }),
    ]);

    const blockNumber = Number(await client.getBlockNumber());
    const feePpm = BigInt(fee).toString();

    return {
      chainId: UNISWAP_V3_CHAIN_ID,
      address: addr,
      kind: 'cl',
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      fee: feePpm,
      feeRaw: feePpm,
      liquidity: BigInt(liquidity).toString(),
      sqrtPriceX96: slot0[0].toString(),
      tick: Number(slot0[1]),
      blockNumber,
    };
  }

  private resolveDirection(
    state: PoolState,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
  ): boolean {
    const t0 = state.token0 as `0x${string}`;
    const t1 = state.token1 as `0x${string}`;
    if (tokenIn === t0 && tokenOut === t1) {
      return true;
    }
    if (tokenIn === t1 && tokenOut === t0) {
      return false;
    }
    throw new Error(
      `tokenIn/tokenOut 与池子 token 不匹配（pool=${state.address} ` +
        `token0=${state.token0} token1=${state.token1} in=${tokenIn} out=${tokenOut}）`,
    );
  }
}
