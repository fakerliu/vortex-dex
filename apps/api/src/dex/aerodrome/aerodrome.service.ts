import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Pool, PoolState } from '../types';
import { AerodromeClassicAdapter } from './aerodrome-classic.adapter';
import { AerodromeClAdapter } from './aerodrome-cl.adapter';
import { AERODROME_CHAIN_ID } from './constants';

/**
 * Aerodrome 协议注册 + 池子落库服务。
 *
 * - 把 classic / CL 两套合约注册为两条 dex_protocols 记录（name 均为 Aerodrome，
 *   protocol_type 区分 adapter，version 区分子协议以满足唯一约束 [chain_id,name,version]）。
 * - 把发现的真实池子写入 pools 表（幂等 upsert，唯一键 [chain_id,pool_address]）。
 *
 * fee 规范化：pools.fee 统一存 ppm（1e6=100%）；classic 已由 adapter 转 ppm。
 */
@Injectable()
export class AerodromeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classic: AerodromeClassicAdapter,
    private readonly cl: AerodromeClAdapter,
  ) {}

  /** 注册 classic / CL 两条协议记录（幂等），返回 keyed by protocol_type 的 id。 */
  async registerProtocols(): Promise<{
    classicId: string;
    clId: string;
  }> {
    const classicInfo = await this.classic.getProtocolInfo();
    const clInfo = await this.cl.getProtocolInfo();

    const [classic, cl] = await Promise.all([
      this.prisma.dexProtocol.upsert({
        where: {
          chain_id_name_version: {
            chain_id: AERODROME_CHAIN_ID,
            name: classicInfo.name,
            version: classicInfo.version,
          },
        },
        update: {
          protocol_type: classicInfo.protocolType,
          factory_address: classicInfo.factoryAddress,
          router_address: classicInfo.routerAddress,
          quoter_address: classicInfo.quoterAddress,
          is_enabled: true,
        },
        create: {
          chain_id: AERODROME_CHAIN_ID,
          name: classicInfo.name,
          protocol_type: classicInfo.protocolType,
          version: classicInfo.version,
          factory_address: classicInfo.factoryAddress,
          router_address: classicInfo.routerAddress,
          quoter_address: classicInfo.quoterAddress,
          is_enabled: true,
        },
      }),
      this.prisma.dexProtocol.upsert({
        where: {
          chain_id_name_version: {
            chain_id: AERODROME_CHAIN_ID,
            name: clInfo.name,
            version: clInfo.version,
          },
        },
        update: {
          protocol_type: clInfo.protocolType,
          factory_address: clInfo.factoryAddress,
          router_address: clInfo.routerAddress,
          quoter_address: clInfo.quoterAddress,
          is_enabled: true,
        },
        create: {
          chain_id: AERODROME_CHAIN_ID,
          name: clInfo.name,
          protocol_type: clInfo.protocolType,
          version: clInfo.version,
          factory_address: clInfo.factoryAddress,
          router_address: clInfo.routerAddress,
          quoter_address: clInfo.quoterAddress,
          is_enabled: true,
        },
      }),
    ]);

    return { classicId: classic.id, clId: cl.id };
  }

  /** 发现并落库某对 token 的全部真实池子（classic volatile/stable + CL 各 tickSpacing）。 */
  async syncPoolsForPair(tokenA: string, tokenB: string): Promise<{
    classic: Pool[];
    cl: Pool[];
  }> {
    const [classicPools, clPools] = await Promise.all([
      this.classic.discoverPools(tokenA, tokenB),
      this.cl.discoverPools(tokenA, tokenB),
    ]);
    const { classicId, clId } = await this.registerProtocols();

    for (const pool of classicPools) {
      const state = await this.classic.getPoolState(pool.address);
      await this.upsertPool(state, classicId);
    }
    for (const pool of clPools) {
      const state = await this.cl.getPoolState(pool.address);
      await this.upsertPool(state, clId);
    }

    return { classic: classicPools, cl: clPools };
  }

  /** 幂等写入 pools 表（唯一键 [chain_id, pool_address]）。 */
  async upsertPool(state: PoolState, protocolId: string): Promise<void> {
    const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

    const liquidity =
      state.kind === 'cl' ? (state.liquidity ?? '0') : (state.totalSupply ?? '0');
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
