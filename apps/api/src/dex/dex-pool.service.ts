import { Injectable, Logger } from '@nestjs/common';
import type { GasEstimate, Pool, QuoteResult } from './types';
import { AerodromeClassicAdapter } from './aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from './aerodrome/aerodrome-cl.adapter';
import { UniswapV3Adapter } from './uniswap-v3/uniswap-v3.adapter';
import {
  AERODROME_PROTOCOL_TYPE_CL,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
} from './aerodrome/constants';
import {
  UNISWAP_V3_CHAIN_ID,
  UNISWAP_V3_PROTOCOL_TYPE,
} from './uniswap-v3/constants';

/** 单池报价候选（含来源协议类型），供 Quote / Route 模块复用。 */
export interface PoolQuoteCandidate {
  pool: Pool;
  protocolType: string;
  quote: QuoteResult;
  gas: GasEstimate;
}

/**
 * DEX 池子发现 + 逐池报价的共享服务（Sprint 4/5 复用，Sprint 10 扩展 Uniswap V3）。
 * 把「发现某 token 对的所有池 + 逐池报价」抽出来，避免 Quote/Route 各自重复实现。
 * RPC 整体失败时向上抛 ChainReadError，由模块层翻译为 503。
 *
 * 链分派：
 * - chainId=8453  → Aerodrome classic + CL
 * - chainId=84532 → Uniswap V3（fee tier 维度）
 */
@Injectable()
export class DexPoolService {
  private readonly logger = new Logger(DexPoolService.name);

  constructor(
    private readonly classic: AerodromeClassicAdapter,
    private readonly cl: AerodromeClAdapter,
    private readonly uniswapV3: UniswapV3Adapter,
  ) {}

  /** 发现 token 对的 classic + CL 池；两者都失败则抛第一个错误（RPC 不可达）。 */
  async discoverPools(
    tokenA: string,
    tokenB: string,
    useClassic = true,
    useCl = true,
  ): Promise<{ classicPools: Pool[]; clPools: Pool[] }> {
    const results = await Promise.allSettled([
      useClassic ? this.classic.discoverPools(tokenA, tokenB) : Promise.resolve([]),
      useCl ? this.cl.discoverPools(tokenA, tokenB) : Promise.resolve([]),
    ]);

    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      throw results[0].reason ?? results[1].reason;
    }
    if (results[0].status === 'rejected') {
      this.logger.warn(`classic 池发现失败（${tokenA}/${tokenB}）: ${this.errMsg(results[0].reason)}`);
    }
    if (results[1].status === 'rejected') {
      this.logger.warn(`CL 池发现失败（${tokenA}/${tokenB}）: ${this.errMsg(results[1].reason)}`);
    }

    return {
      classicPools: results[0].status === 'fulfilled' ? results[0].value : [],
      clPools: results[1].status === 'fulfilled' ? results[1].value : [],
    };
  }

  /** 对某 token 对的所有池逐池报价；单池失败跳过。 */
  async quotePair(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    classicPools: Pool[],
    clPools: Pool[],
  ): Promise<PoolQuoteCandidate[]> {
    const candidates: PoolQuoteCandidate[] = [];

    for (const pool of classicPools) {
      const params = {
        chainId,
        poolAddress: pool.address,
        tokenIn,
        tokenOut,
        amountIn,
      };
      try {
        const quote = await this.classic.getQuote(params);
        const gas = quote.gasEstimate
          ? { gasLimit: quote.gasEstimate, source: 'static' as const, estimated: true }
          : await this.classic.estimateGas(params);
        candidates.push({
          pool,
          protocolType: AERODROME_PROTOCOL_TYPE_CLASSIC,
          quote,
          gas,
        });
      } catch (err) {
        this.logger.warn(`classic 池报价失败 ${pool.address}: ${this.errMsg(err)}`);
      }
    }

    for (const pool of clPools) {
      const params = {
        chainId,
        poolAddress: pool.address,
        tokenIn,
        tokenOut,
        amountIn,
      };
      try {
        const quote = await this.cl.getQuote(params);
        const gas = quote.gasEstimate
          ? { gasLimit: quote.gasEstimate, source: 'quoter-simulation' as const, estimated: true }
          : await this.cl.estimateGas(params);
        candidates.push({
          pool,
          protocolType: AERODROME_PROTOCOL_TYPE_CL,
          quote,
          gas,
        });
      } catch (err) {
        this.logger.warn(`CL 池报价失败 ${pool.address}: ${this.errMsg(err)}`);
      }
    }

    return candidates;
  }

  /** 对某 token 对报价，返回 amountOut 最大的候选（无候选返回 null）。 */
  async quoteBest(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    useClassic = true,
    useCl = true,
  ): Promise<PoolQuoteCandidate | null> {
    const { classicPools, clPools } = await this.discoverPools(
      tokenIn,
      tokenOut,
      useClassic,
      useCl,
    );
    if (classicPools.length === 0 && clPools.length === 0) {
      return null;
    }
    const candidates = await this.quotePair(
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      classicPools,
      clPools,
    );
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((a, b) =>
      BigInt(a.quote.amountOut) >= BigInt(b.quote.amountOut) ? a : b,
    );
  }

  // ---------- Uniswap V3（Base Sepolia 84532） ----------

  /** 发现 token 对的 Uniswap V3 池（各 fee tier）。 */
  async discoverUniswapV3Pools(tokenA: string, tokenB: string): Promise<Pool[]> {
    return this.uniswapV3.discoverPools(tokenA, tokenB);
  }

  /** 对某 token 对的 Uniswap V3 池逐池报价；单池失败跳过。 */
  async quoteUniswapV3Pair(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    pools: Pool[],
  ): Promise<PoolQuoteCandidate[]> {
    const candidates: PoolQuoteCandidate[] = [];
    for (const pool of pools) {
      const params = {
        chainId,
        poolAddress: pool.address,
        tokenIn,
        tokenOut,
        amountIn,
      };
      try {
        const quote = await this.uniswapV3.getQuote(params);
        const gas = quote.gasEstimate
          ? { gasLimit: quote.gasEstimate, source: 'quoter-simulation' as const, estimated: true }
          : await this.uniswapV3.estimateGas(params);
        candidates.push({
          pool,
          protocolType: UNISWAP_V3_PROTOCOL_TYPE,
          quote,
          gas,
        });
      } catch (err) {
        this.logger.warn(`Uniswap V3 池报价失败 ${pool.address}: ${this.errMsg(err)}`);
      }
    }
    return candidates;
  }

  /** 对某 token 对走 Uniswap V3 报价，返回 amountOut 最大的候选。 */
  async quoteBestUniswapV3(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
  ): Promise<PoolQuoteCandidate | null> {
    const pools = await this.discoverUniswapV3Pools(tokenIn, tokenOut);
    if (pools.length === 0) {
      return null;
    }
    const candidates = await this.quoteUniswapV3Pair(
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      pools,
    );
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((a, b) =>
      BigInt(a.quote.amountOut) >= BigInt(b.quote.amountOut) ? a : b,
    );
  }

  /** 按 chainId 分派最优报价（84532 走 Uniswap V3，其余走 Aerodrome）。 */
  async quoteBestForChain(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    useClassic = true,
    useCl = true,
    useUniswapV3 = true,
  ): Promise<PoolQuoteCandidate | null> {
    if (chainId === UNISWAP_V3_CHAIN_ID) {
      return useUniswapV3
        ? this.quoteBestUniswapV3(chainId, tokenIn, tokenOut, amountIn)
        : null;
    }
    return this.quoteBest(chainId, tokenIn, tokenOut, amountIn, useClassic, useCl);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
