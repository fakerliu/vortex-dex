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
  computePriceImpactFromSpot,
  getAmountOutConstantProduct,
  parseAmount,
} from '../math';
import {
  aerodromeClassicFactoryAbi,
  aerodromeClassicPoolAbi,
} from './abis';
import {
  AERODROME_CHAIN_ID,
  AERODROME_CLASSIC_FACTORY,
  AERODROME_CLASSIC_ROUTER,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
  DEFAULT_SWAP_GAS_LIMIT,
} from './constants';
import {
  callView,
  feeBpsToPpm,
  isZeroAddress,
  toAddress,
} from './aerodrome.utils';

/**
 * Aerodrome classic（Velodrome v2 fork）Adapter。
 *
 * - volatile 池：恒定乘积 x*y=k，用 getReserves + fee 计算 amountOut 与价格影响。
 * - stable 池：stableswap 不变式（非 x*y=k），报价走池子链上 getAmountOut，
 *   价格影响用「执行价 vs 储备比率」做一阶近似（已标注近似）。
 *
 * 铁律：volatile 用 V2 公式，stable 不套 V2 公式；所有金额 BigInt/字符串。
 */
@Injectable()
export class AerodromeClassicAdapter implements DexAdapter {
  constructor(private readonly rpc: ChainRpcService) {}

  async getProtocolInfo(): Promise<ProtocolInfo> {
    return {
      chainId: AERODROME_CHAIN_ID,
      name: 'Aerodrome',
      protocolType: AERODROME_PROTOCOL_TYPE_CLASSIC,
      version: 'v1',
      factoryAddress: AERODROME_CLASSIC_FACTORY.toLowerCase(),
      routerAddress: AERODROME_CLASSIC_ROUTER.toLowerCase(),
      quoterAddress: null, // classic 无独立 Quoter，报价走池子 getAmountOut
      verified: true,
      verificationSource:
        'aerodrome.finance/security 部署清单 + 链上核验：PoolFactory.allPoolsLength()=29885、' +
        'getPool(WETH,USDC,false/true) 返回真实池子、Router 链上 code 非空',
    };
  }

  async discoverPools(tokenA: string, tokenB: string): Promise<Pool[]> {
    const a = toAddress(tokenA, 'tokenA');
    const b = toAddress(tokenB, 'tokenB');
    const client = this.client();
    const factory = AERODROME_CLASSIC_FACTORY as `0x${string}`;

    const pools: Pool[] = [];
    for (const stable of [false, true]) {
      const addr = await callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: factory,
        abi: aerodromeClassicFactoryAbi,
        functionName: 'getPool',
        args: [a, b, stable],
        label: `classic factory getPool(${a}, ${b}, ${stable})`,
      });
      if (isZeroAddress(addr)) {
        continue;
      }
      pools.push(await this.buildPool(addr, stable));
    }
    return pools;
  }

  async getPoolState(poolAddress: string): Promise<PoolState> {
    const addr = toAddress(poolAddress, 'poolAddress');
    const client = this.client();
    const core = await this.readCore(client, addr);
    return core.state;
  }

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const poolAddress = toAddress(params.poolAddress, 'poolAddress');
    const tokenIn = toAddress(params.tokenIn, 'tokenIn');
    const tokenOut = toAddress(params.tokenOut, 'tokenOut');
    const amountIn = parseAmount(params.amountIn);
    if (amountIn <= 0n) {
      throw new Error(`amountIn 必须为正数: ${params.amountIn}`);
    }

    const client = this.client();
    const { state, reserve0, reserve1 } = await this.readCore(
      client,
      poolAddress,
    );

    // 校验 tokenIn/tokenOut 与池子 token 匹配，并确定方向
    const { reserveIn, reserveOut } = this.resolveDirection(
      state,
      tokenIn,
      tokenOut,
      reserve0,
      reserve1,
    );

    const feePpm = BigInt(state.fee);

    // stable 池走链上 getAmountOut（stableswap 不变式），volatile 走 V2 公式
    let amountOut: bigint;
    let source: QuoteResult['source'];
    let priceImpact: string;
    if (state.kind === 'classic-stable') {
      amountOut = await callView<bigint>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: poolAddress,
        abi: aerodromeClassicPoolAbi,
        functionName: 'getAmountOut',
        args: [amountIn, tokenIn],
        label: `classic pool getAmountOut(${amountIn}, ${tokenIn})`,
      });
      source = 'onchain-getAmountOut';
      // stable 池无解析即期价，用小额 probe 交易的边际价近似即期价，再算价格影响
      const probeIn = reserveIn / 10_000n || 1n; // 约 0.01% 储备量
      const probeOut = await callView<bigint>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: poolAddress,
        abi: aerodromeClassicPoolAbi,
        functionName: 'getAmountOut',
        args: [probeIn, tokenIn],
        label: `classic pool getAmountOut probe(${probeIn}, ${tokenIn})`,
      });
      priceImpact = computePriceImpactFromSpot({
        amountIn,
        amountOut,
        spotPriceNum: probeOut,
        spotPriceDen: probeIn,
      });
    } else {
      amountOut = getAmountOutConstantProduct({
        reserveIn,
        reserveOut,
        amountIn,
        feePpm,
      });
      source = 'constant-product';
      // volatile 恒定乘积价格影响（精确）
      priceImpact = computePriceImpact({
        amountIn,
        amountOut,
        midNum: reserveOut,
        midDen: reserveIn,
      });
    }

    return {
      chainId: AERODROME_CHAIN_ID,
      poolAddress,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      kind: state.kind,
      fee: state.fee,
      priceImpact,
      source,
      route: [{ pool: poolAddress, kind: state.kind }],
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
    };
  }

  async estimateGas(_params: QuoteParams): Promise<GasEstimate> {
    // Sprint 3 不实现 eth_estimateGas 仿真（需完整 calldata + from，属 Swap Execution）。
    return {
      gasLimit: DEFAULT_SWAP_GAS_LIMIT.toString(),
      source: 'static',
      estimated: true,
      note: '静态估算值；精确 gas 需在 Swap 执行阶段经 eth_estimateGas 仿真',
    };
  }

  // ---------- 私有 ----------

  private client(): PublicClient {
    return this.rpc.getClient(AERODROME_CHAIN_ID);
  }

  /** 组装 discovered 池子的元信息（token0/token1 + fee）。 */
  private async buildPool(address: string, stable: boolean): Promise<Pool> {
    const addr = address as `0x${string}`;
    const client = this.client();
    const factory = AERODROME_CLASSIC_FACTORY as `0x${string}`;

    const [token0, token1, feeBps] = await Promise.all([
      callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClassicPoolAbi,
        functionName: 'token0',
        label: 'classic pool token0()',
      }),
      callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClassicPoolAbi,
        functionName: 'token1',
        label: 'classic pool token1()',
      }),
      callView<bigint>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: factory,
        abi: aerodromeClassicFactoryAbi,
        functionName: 'getFee',
        args: [addr, stable],
        label: `classic factory getFee(${addr}, ${stable})`,
      }),
    ]);

    const feePpm = feeBpsToPpm(feeBps);
    return {
      chainId: AERODROME_CHAIN_ID,
      address: addr,
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      kind: stable ? 'classic-stable' : 'classic-volatile',
      fee: feePpm.toString(),
      feeRaw: feeBps.toString(),
      stable,
    };
  }

  /** 读取池子核心状态（token/stable/reserves/totalSupply/fee）。 */
  private async readCore(
    client: PublicClient,
    addr: `0x${string}`,
  ): Promise<{
    state: PoolState;
    reserve0: bigint;
    reserve1: bigint;
  }> {
    const factory = AERODROME_CLASSIC_FACTORY as `0x${string}`;

    const [token0, token1, stable, reserves, totalSupply] = await Promise.all([
      callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClassicPoolAbi,
        functionName: 'token0',
        label: 'classic pool token0()',
      }),
      callView<string>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClassicPoolAbi,
        functionName: 'token1',
        label: 'classic pool token1()',
      }),
      callView<boolean>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClassicPoolAbi,
        functionName: 'stable',
        label: 'classic pool stable()',
      }),
      callView<readonly [bigint, bigint]>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClassicPoolAbi,
        functionName: 'getReserves',
        label: 'classic pool getReserves()',
      }),
      callView<bigint>({
        client,
        chainId: AERODROME_CHAIN_ID,
        address: addr,
        abi: aerodromeClassicPoolAbi,
        functionName: 'totalSupply',
        label: 'classic pool totalSupply()',
      }),
    ]);

    const feeBps = await callView<bigint>({
      client,
      chainId: AERODROME_CHAIN_ID,
      address: factory,
      abi: aerodromeClassicFactoryAbi,
      functionName: 'getFee',
      args: [addr, stable],
      label: `classic factory getFee(${addr}, ${stable})`,
    });

    const blockNumber = Number(await client.getBlockNumber());
    const reserve0 = reserves[0];
    const reserve1 = reserves[1];
    const feePpm = feeBpsToPpm(feeBps);

    const state: PoolState = {
      chainId: AERODROME_CHAIN_ID,
      address: addr,
      kind: stable ? 'classic-stable' : 'classic-volatile',
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      fee: feePpm.toString(),
      feeRaw: feeBps.toString(),
      stable,
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
      totalSupply: totalSupply.toString(),
      blockNumber,
    };

    return { state, reserve0, reserve1 };
  }

  private resolveDirection(
    state: PoolState,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    reserve0: bigint,
    reserve1: bigint,
  ): { reserveIn: bigint; reserveOut: bigint } {
    if (tokenIn === (state.token0 as `0x${string}`) && tokenOut === (state.token1 as `0x${string}`)) {
      return { reserveIn: reserve0, reserveOut: reserve1 };
    }
    if (tokenIn === (state.token1 as `0x${string}`) && tokenOut === (state.token0 as `0x${string}`)) {
      return { reserveIn: reserve1, reserveOut: reserve0 };
    }
    throw new Error(
      `tokenIn/tokenOut 与池子 token 不匹配（pool=${state.address} ` +
        `token0=${state.token0} token1=${state.token1} in=${tokenIn} out=${tokenOut}）`,
    );
  }
}
