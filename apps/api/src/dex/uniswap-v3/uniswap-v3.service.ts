import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Pool, PoolState } from '../types';
import { UniswapV3Adapter } from './uniswap-v3.adapter';
import { UNISWAP_V3_CHAIN_ID } from './constants';

/**
 * Uniswap V3 协议注册 + 池子落库服务（Base Sepolia 84532）。
 *
 * - 注册一条 dex_protocols 记录（protocol_type=uniswap_v3）。
 * - 把发现的真实池子写入 pools 表（幂等 upsert，唯一键 [chain_id,pool_address]）。
 * - fee 规范化：Uniswap V3 fee() 本身就是 ppm（1e6=100%），无需换算。
 */
@Injectable()
export class UniswapV3Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: UniswapV3Adapter,
  ) {}

  /** 注册 uniswap_v3 协议记录（幂等），返回 protocol id。 */
  async registerProtocol(): Promise<string> {
    const info = await this.adapter.getProtocolInfo();
    const row = await this.prisma.dexProtocol.upsert({
      where: {
        chain_id_name_version: {
          chain_id: UNISWAP_V3_CHAIN_ID,
          name: info.name,
          version: info.version,
        },
      },
      update: {
        protocol_type: info.protocolType,
        factory_address: info.factoryAddress,
        router_address: info.routerAddress,
        quoter_address: info.quoterAddress,
        is_enabled: true,
      },
      create: {
        chain_id: UNISWAP_V3_CHAIN_ID,
        name: info.name,
        protocol_type: info.protocolType,
        version: info.version,
        factory_address: info.factoryAddress,
        router_address: info.routerAddress,
        quoter_address: info.quoterAddress,
        is_enabled: true,
      },
    });
    return row.id;
  }

  /** 发现并落库某对 token 的全部真实池子（各 fee tier）。 */
  async syncPoolsForPair(tokenA: string, tokenB: string): Promise<Pool[]> {
    const pools = await this.adapter.discoverPools(tokenA, tokenB);
    const protocolId = await this.registerProtocol();
    for (const pool of pools) {
      const state = await this.adapter.getPoolState(pool.address);
      await this.upsertPool(state, protocolId);
    }
    return pools;
  }

  /** 幂等写入 pools 表（唯一键 [chain_id, pool_address]）。 */
  async upsertPool(state: PoolState, protocolId: string): Promise<void> {
    const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

    const liquidity = state.liquidity ?? '0';
    const reserve0 = state.reserve0 ?? '0';
    const reserve1 = state.reserve1 ?? '0';

    await this.prisma.pool.upsert({
      where: {
        chain_id_pool_address: {
          chain_id: state.chainId,
          pool_address: state.address,
        },
      },
      update: {
        protocol_id: protocolId,
        token0_address: state.token0,
        token1_address: state.token1,
        fee: d(state.fee),
        liquidity: d(liquidity),
        reserve0: d(reserve0),
        reserve1: d(reserve1),
        last_synced_block: state.blockNumber,
      },
      create: {
        chain_id: state.chainId,
        protocol_id: protocolId,
        token0_address: state.token0,
        token1_address: state.token1,
        fee: d(state.fee),
        pool_address: state.address,
        liquidity: d(liquidity),
        reserve0: d(reserve0),
        reserve1: d(reserve1),
        last_synced_block: state.blockNumber,
      },
    });
  }
}
