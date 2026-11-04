import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Pool, Token } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DataAuthenticity } from '../../common/constants/data-authenticity';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import type {
  PoolDetailDto,
  PoolListItemDto,
  PoolListResult,
  PoolSnapshotDto,
  PoolTokenRef,
} from './pool.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** 详情页返回的历史快照条数上限。 */
const MAX_SNAPSHOTS = 100;

/** Prisma.Decimal -> 干净十进制字符串（去尾零），null 透传。 */
function decimalToString(d: Prisma.Decimal | null | undefined): string | null {
  if (d == null) {
    return null;
  }
  let s = d.toString();
  if (s.includes('.')) {
    s = s.replace(/0+$/, '');
    s = s.replace(/\.$/, '');
  }
  return s;
}

/**
 * Pool Explorer（MODULE 09）。
 *
 * 只读聚合，不发 RPC / 不触发池子发现：
 * - 列表：查 pools 表，join dex_protocols（protocol_type / name）+ Token 表
 *   （token0/token1 的 symbol / decimals）。
 * - 详情：额外附 pool_snapshots 最近 N 条历史（reserve0/reserve1/liquidity
 *   随时间变化，按 block_number 升序）。
 *
 * 优雅降级：pools 表为空时如实返回空列表（items: [] + total: 0），
 * 不报错、不编造数据 —— 池数据由报价/路由引擎在真实交易时触发落库。
 */
@Injectable()
export class PoolService {
  private readonly logger = new Logger(PoolService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    chainId?: number;
    token0?: string;
    token1?: string;
    page?: number;
    limit?: number;
  }): Promise<PoolListResult> {
    const chainId = this.resolveChainId(params.chainId);
    const token0 = this.normalizeAddressParam(params.token0, 'token0');
    const token1 = this.normalizeAddressParam(params.token1, 'token1');
    const page = this.normalizePage(params.page);
    const limit = this.normalizeLimit(params.limit);

    const where: Prisma.PoolWhereInput = {
      chain_id: chainId,
      ...(token0 ? { token0_address: token0 } : {}),
      ...(token1 ? { token1_address: token1 } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.pool.findMany({
        where,
        include: { protocol: true },
        orderBy: [{ liquidity: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pool.count({ where }),
    ]);

    const items = await this.buildListItems(chainId, rows);

    return { items, page, limit, total };
  }

  async detail(id: string): Promise<PoolDetailDto> {
    const row = await this.prisma.pool.findUnique({
      where: { id },
      include: { protocol: true },
    });
    if (!row) {
      throw new NotFoundException(`流动性池不存在: ${id}`);
    }

    const [tokenMap, snapshots] = await Promise.all([
      this.fetchTokenMap(row.chain_id, [
        row.token0_address,
        row.token1_address,
      ]),
      this.fetchSnapshots(id),
    ]);

    const item = this.toListItemDto(row, tokenMap);
    return { ...item, snapshots };
  }

  // ---------- 私有工具 ----------

  /** 组装列表项：批量查 Token 元数据后逐条映射。 */
  private async buildListItems(
    chainId: number,
    rows: Array<Pool & { protocol: { protocol_type: string; name: string } }>,
  ): Promise<PoolListItemDto[]> {
    const addresses = new Set<string>();
    for (const row of rows) {
      addresses.add(row.token0_address);
      addresses.add(row.token1_address);
    }
    const tokenMap = await this.fetchTokenMap(chainId, [...addresses]);
    return rows.map((row) => this.toListItemDto(row, tokenMap));
  }

  /** 批量查某链上若干 token 的元数据，keyed by 小写地址。 */
  private async fetchTokenMap(
    chainId: number,
    addresses: string[],
  ): Promise<Map<string, Token>> {
    if (addresses.length === 0) {
      return new Map();
    }
    try {
      const tokens = await this.prisma.token.findMany({
        where: { chain_id: chainId, address: { in: addresses } },
      });
      return new Map(tokens.map((t) => [t.address, t]));
    } catch (err) {
      this.logger.warn(
        `Token 元数据查询失败（chain=${chainId}）: ${this.errMsg(err)}`,
      );
      return new Map();
    }
  }

  private toListItemDto(
    row: Pool & { protocol: { protocol_type: string; name: string } },
    tokenMap: Map<string, Token>,
  ): PoolListItemDto {
    const token0 = tokenMap.get(row.token0_address);
    const token1 = tokenMap.get(row.token1_address);

    return {
      id: row.id,
      chainId: row.chain_id,
      poolAddress: row.pool_address,
      protocolType: row.protocol.protocol_type,
      protocolName: row.protocol.name,
      token0: this.toTokenRef(row.token0_address, token0),
      token1: this.toTokenRef(row.token1_address, token1),
      fee: decimalToString(row.fee) ?? '0',
      liquidity: decimalToString(row.liquidity) ?? '0',
      reserve0: decimalToString(row.reserve0) ?? '0',
      reserve1: decimalToString(row.reserve1) ?? '0',
      lastSyncedBlock: row.last_synced_block,
      authenticity: DataAuthenticity.REAL_ONCHAIN,
    };
  }

  private toTokenRef(address: string, token?: Token): PoolTokenRef {
    return {
      address,
      symbol: token?.symbol ?? null,
      decimals: token?.decimals ?? null,
    };
  }

  private async fetchSnapshots(poolId: string): Promise<PoolSnapshotDto[]> {
    try {
      const rows = await this.prisma.poolSnapshot.findMany({
        where: { pool_id: poolId },
        orderBy: { block_number: 'asc' },
        take: MAX_SNAPSHOTS,
      });
      return rows.map((s) => ({
        blockNumber: s.block_number,
        reserve0: decimalToString(s.reserve0) ?? '0',
        reserve1: decimalToString(s.reserve1) ?? '0',
        liquidity: decimalToString(s.liquidity) ?? '0',
        createdAt: s.created_at.toISOString(),
      }));
    } catch (err) {
      this.logger.warn(`池快照查询失败（pool=${poolId}）: ${this.errMsg(err)}`);
      return [];
    }
  }

  private resolveChainId(chainId?: number): number {
    const resolved = chainId ?? BASE_MAINNET_CHAIN_ID;
    if (!isSupportedChainId(resolved)) {
      throw new BadRequestException(
        `不支持的 chainId: ${resolved}（支持 8453 / 84532）`,
      );
    }
    return resolved;
  }

  private normalizeAddressParam(
    value: string | undefined,
    name: string,
  ): string | undefined {
    if (value === undefined || value.trim() === '') {
      return undefined;
    }
    const trimmed = value.trim();
    if (!isValidAddress(trimmed)) {
      throw new BadRequestException(`参数 ${name} 不是合法的 EVM 地址`);
    }
    return normalizeAddress(trimmed);
  }

  private normalizePage(page?: number): number {
    if (page === undefined) {
      return 1;
    }
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page 必须是 >= 1 的整数');
    }
    return page;
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined) {
      return DEFAULT_LIMIT;
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('limit 必须是 >= 1 的整数');
    }
    return Math.min(limit, MAX_LIMIT);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
