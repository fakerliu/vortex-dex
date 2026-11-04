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
  aerodromeClFactoryAbi,
  aerodromeClPoolAbi,
  aerodromeQuoterAbi,
} from './abis';
import {
  AERODROME_CHAIN_ID,
  AERODROME_CL_FACTORY,
  AERODROME_CL_TICK_SPACINGS,
  AERODROME_NONFUNGIBLE_POSITION_MANAGER,
  AERODROME_PROTOCOL_TYPE_CL,
  AERODROME_QUOTER,
  AERODROME_SWAP_ROUTER,
} from './constants';
import { callView, isZeroAddress, toAddress } from './aerodrome.utils';

/** Quoter quoteExactInputSingle 的完整返回（QuoterV2 四元组，viem 按数组返回）。 */
type QuoteExactInputSingleResult = readonly [
  amountOut: bigint,
  sqrtPriceX96After: bigint,
  initializedTicksCrossed: number,
  gasEstimate: bigint,
];

/**
 * Aerodrome Slipstream（集中流动性 CL，Uniswap v3 fork）Adapter。
 *
 * - 报价优先走官方 QuoterV2 的 quoteExactInputSingle（内部用集中流动性 tick 数学模拟），
 *   绝不手写 V2 恒定乘积公式套 V3。
 * - 池子维度是 tickSpacing（int24），不是 Uniswap v3 的 fee(uint24)。
 * - 价格影响用 slot0.sqrtPriceX96 推导即期价，做一阶近似（已标注近似）。
 */
@Injectable()
export class AerodromeClAdapter implements DexAdapter {
  constructor(private readonly rpc: ChainRpcService) {}

  async getProtocolInfo(): Promise<ProtocolInfo> {
    return {
      chainId: AERODROME_CHAIN_ID,
      name: 'Aerodrome',
      protocolType: AERODROME_PROTOCOL_TYPE_CL,
      version: 'v1-sl',
      factoryAddress: AERODROME_CL_FACTORY.toLowerCase(),
      routerAddress: AERODROME_SWAP_ROUTER.toLowerCase(),
      quoterAddress: AERODROME_QUOTER.toLowerCase(),
      verified: true,
      verificationSource:
        'aerodrome.finance/security 部署清单 + 链上核验：CL PoolFactory.getPool(WETH,USDC,100) ' +
        '返回真实池子、QuoterV2.quoteExactInputSingle 返回合理 amountOut、' +
        `NFPM(${AERODROME_NONFUNGIBLE_POSITION_MANAGER.toLowerCase()}) code 存在`,
    };
  }

  async discoverPools(tokenA: string, tokenB: string): Promise<Pool[]> {
    const a = toAddress(tokenA, 'tokenA');
    const b = toAddress(tokenB, 'tokenB');
    const client = this.client();
    const factory = AERODROME_CL_FACTORY as `0x${string}`;

    const pools: Pool[] = [];
    for (const tickSpacing of AERODROME_CL_TICK_SPACINGS) {
      const addr = await callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: factory,
        abi: aerodromeClFactoryAbi,
        functionName: 'getPool',
        args: [a, b, tickSpacing],
        label: `CL factory getPool(${a}, ${b}, ${tickSpacing})`,
      });
      if (isZeroAddress(addr)) {
        continue;
      }
      pools.push(await this.buildPool(addr, tickSpacing));
    }
    return pools;
  }

  async getPoolState(poolAddress: string): Promise<PoolState> {
    const addr = toAddress(poolAddress, 'poolAddress');
    const client = this.client();
    return this.readCore(client, addr);
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
      chainId: AERODROME_CHAIN_ID,
      address: AERODROME_QUOTER as `0x${string}`,
      abi: aerodromeQuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          amountIn,
          tickSpacing: state.tickSpacing,
          sqrtPriceLimitX96,
        },
      ],
      label: `Quoter.quoteExactInputSingle(${tokenIn}->${tokenOut}, ${amountIn}, ts=${state.tickSpacing})`,
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
      chainId: AERODROME_CHAIN_ID,
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
        chainId: AERODROME_CHAIN_ID,
        address: AERODROME_QUOTER as `0x${string}`,
        abi: aerodromeQuoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            amountIn,
            tickSpacing: state.tickSpacing,
            sqrtPriceLimitX96,
          },
        ],
        label: 'Quoter.quoteExactInputSingle (estimateGas)',
      });
      return {
        gasLimit: res[3].toString(),
        source: 'quoter-simulation',
        estimated: true,
        note: '来自 QuoterV2 内部 swap 仿真的 gasEstimate',
      };
    } catch {
      // 优雅降级为静态值
      return {
        gasLimit: '250000',
        source: 'static',
        estimated: true,
        note: 'Quoter 仿真失败，降级为静态估算值',
      };
    }
  }

  // ---------- 私有 ----------

  private client(): PublicClient {
    return this.rpc.getClient(AERODROME_CHAIN_ID);
  }

  private async buildPool(address: string, tickSpacing: number): Promise<Pool> {
    const addr = address as `0x${string}`;
    const client = this.client();
    const [token0, token1, fee] = await Promise.all([
      callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClPoolAbi,
        functionName: 'token0',
        label: 'CL pool token0()',
      }),
      callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClPoolAbi,
        functionName: 'token1',
        label: 'CL pool token1()',
      }),
      callView<number>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClPoolAbi,
        functionName: 'fee',
        label: 'CL pool fee()',
      }),
    ]);

    return {
      chainId: AERODROME_CHAIN_ID,
      address: addr,
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      kind: 'cl',
      fee: BigInt(fee).toString(),
      feeRaw: fee.toString(),
      tickSpacing,
    };
  }

  /** 读取 CL 池子核心状态（token/fee/tickSpacing/liquidity/slot0）。 */
  private async readCore(
    client: PublicClient,
    addr: `0x${string}`,
  ): Promise<PoolState> {
    const [token0, token1, fee, tickSpacing, liquidity, slot0] =
      await Promise.all([
        callView<string>({
          client,
          chainId: AERODROME_CHAIN_ID,
          address: addr,
          abi: aerodromeClPoolAbi,
          functionName: 'token0',
          label: 'CL pool token0()',
        }),
        callView<string>({
          client,
          chainId: AERODROME_CHAIN_ID,
          address: addr,
          abi: aerodromeClPoolAbi,
          functionName: 'token1',
          label: 'CL pool token1()',
        }),
        callView<number>({
          client,
          chainId: AERODROME_CHAIN_ID,
          address: addr,
          abi: aerodromeClPoolAbi,
          functionName: 'fee',
          label: 'CL pool fee()',
        }),
        callView<number>({
          client,
          chainId: AERODROME_CHAIN_ID,
          address: addr,
          abi: aerodromeClPoolAbi,
          functionName: 'tickSpacing',
          label: 'CL pool tickSpacing()',
        }),
        callView<bigint>({
          client,
          chainId: AERODROME_CHAIN_ID,
          address: addr,
          abi: aerodromeClPoolAbi,
          functionName: 'liquidity',
          label: 'CL pool liquidity()',
        }),
        callView<readonly [bigint, number, number, number, number, boolean]>({
          client,
          chainId: AERODROME_CHAIN_ID,
          address: addr,
          abi: aerodromeClPoolAbi,
          functionName: 'slot0',
          label: 'CL pool slot0()',
        }),
      ]);

    const blockNumber = Number(await client.getBlockNumber());

    return {
      chainId: AERODROME_CHAIN_ID,
      address: addr,
      kind: 'cl',
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      fee: BigInt(fee).toString(),
      feeRaw: fee.toString(),
      tickSpacing: Number(tickSpacing),
      liquidity: BigInt(liquidity).toString(),
      sqrtPriceX96: slot0[0].toString(),
      tick: Number(slot0[1]),
      dynamicFee: Number(slot0[2]),
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
