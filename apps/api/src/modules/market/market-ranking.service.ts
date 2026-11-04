import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MarketSnapshot, Token } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DataAuthenticity } from '../../common/constants/data-authenticity';
import { formatUnits } from '../../common/utils/units';
import { parseDecimal } from '../../dex/math';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { normalizeAddress } from '../../chain/address';
import { getCatalogEntry } from '../../chain/token-catalog';
import type { RankingItem, RankingResult, RankingSortBy } from './market.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** 成交量统计窗口：近 24h。 */
const VOLUME_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 定点小数精度（与 dex/math 的 parseDecimal / formatUnits 一致，18 位）。 */
const PRICE_SCALE = 18n;

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

/** 降序比较两个十进制字符串（null 排最后），纯 BigInt，不用 Float。 */
function compareDesc(a: string | null, b: string | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  const x = parseDecimal(a, PRICE_SCALE);
  const y = parseDecimal(b, PRICE_SCALE);
  return x < y ? 1 : x > y ? -1 : 0;
}

/**
 * Explore 代币榜单聚合（Sprint 3）。
 *
 * 只读聚合，不发 RPC / 不推导价格：
 * - 价格：取 market_snapshots 该链最新快照（price_usd / quote_token /
 *   block_number / authenticity / source）。
 * - 元数据：join Token 表拿 symbol / name / logo / verified / risk。
 * - 成交量：从 Swap 表按 token_out 聚合近 24h 的 amount_out，再按该 token
 *   价格换算为 USD（volumeUsd）。Swap 表无数据则如实返回 0，不编造。
 *
 * 榜单基集 = Token 注册表 ∪ 快照表。无快照的 token 仍返回（priceUsd=null +
 * authenticity=UNAVAILABLE），不丢弃。
 *
 * 排序：
 * - 默认（未传 sortBy）按 priceUsd 降序。
 * - sortBy=volume 按 volumeUsd 降序（tie-break 价格降序再 symbol 升序）。
 * - sortBy=price_change 因暂无历史快照，回退为 priceUsd 降序。
 */
@Injectable()
export class MarketRankingService {
  private readonly logger = new Logger(MarketRankingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRanking(
    chainId: number | undefined,
    sortBy?: RankingSortBy,
    limit?: number,
  ): Promise<RankingResult> {
    const resolvedChainId = this.resolveChainId(chainId);
    const resolvedLimit = this.normalizeLimit(limit);
    const effectiveSort = this.resolveSort(sortBy);

    const [tokens, snapshots, volumeMap] = await Promise.all([
      this.prisma.token.findMany({ where: { chain_id: resolvedChainId } }),
      this.prisma.marketSnapshot.findMany({
        where: { chain_id: resolvedChainId },
      }),
      this.aggregateVolume(resolvedChainId),
    ]);

    const tokenByAddr = new Map<string, Token>(
      tokens.map((t) => [t.address, t]),
    );
    const snapshotByAddr = new Map<string, MarketSnapshot>(
      snapshots.map((s) => [s.token_address, s]),
    );

    // 基集：Token 注册表 ∪ 快照表，确保无快照 token 也返回。
    const addresses = new Set<string>([
      ...tokenByAddr.keys(),
      ...snapshotByAddr.keys(),
    ]);

    const items: RankingItem[] = [];
    for (const address of addresses) {
      items.push(
        this.buildItem(
          resolvedChainId,
          address,
          tokenByAddr.get(address),
          snapshotByAddr.get(address),
          volumeMap,
        ),
      );
    }

    this.sortItems(items, effectiveSort);

    return {
      chainId: resolvedChainId,
      sortBy: effectiveSort,
      limit: resolvedLimit,
      items: items.slice(0, resolvedLimit),
    };
  }

  // ---------- 私有工具 ----------

  /** 聚合近 24h 各 token_out 的 amount_out 原始大整数；查询失败返回 null（如实降级）。 */
  private async aggregateVolume(
    chainId: number,
  ): Promise<Map<string, bigint> | null> {
    const since = new Date(Date.now() - VOLUME_WINDOW_MS);
    try {
      const grouped = await this.prisma.swap.groupBy({
        by: ['token_out'],
        where: {
          chain_id: chainId,
          status: 'CONFIRMED',
          created_at: { gte: since },
        },
        _sum: { amount_out: true },
      });

      const map = new Map<string, bigint>();
      for (const g of grouped) {
        const sum = g._sum.amount_out;
        if (sum == null) {
          continue;
        }
        const address = normalizeAddress(g.token_out);
        const raw = BigInt(sum.toString());
        map.set(address, (map.get(address) ?? 0n) + raw);
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `Swap 成交量聚合失败（chain=${chainId}）: ${this.errMsg(err)}`,
      );
      return null;
    }
  }

  private buildItem(
    chainId: number,
    address: string,
    token: Token | undefined,
    snapshot: MarketSnapshot | undefined,
    volumeMap: Map<string, bigint> | null,
  ): RankingItem {
    const priceUsd = snapshot ? decimalToString(snapshot.price_usd) : null;
    const decimals =
      token?.decimals ?? getCatalogEntry(chainId, address)?.decimals ?? 18;

    // volume：内部聚合估算。无价格或聚合失败无法换算 USD，如实标注 UNAVAILABLE。
    let volumeUsd: string | null;
    let volumeAuthenticity: DataAuthenticity;
    if (priceUsd === null || volumeMap === null) {
      volumeUsd = null;
      volumeAuthenticity = DataAuthenticity.UNAVAILABLE;
    } else {
      const rawOut = volumeMap.get(address) ?? 0n;
      const priceFixed = parseDecimal(priceUsd, PRICE_SCALE);
      const volumeFixed = (rawOut * priceFixed) / 10n ** BigInt(decimals);
      volumeUsd = formatUnits(volumeFixed.toString(), Number(PRICE_SCALE));
      volumeAuthenticity = DataAuthenticity.INTERNAL_CALCULATED;
    }

    return {
      chainId,
      address,
      symbol: token?.symbol ?? null,
      name: token?.name ?? null,
      logoURI: token?.logo_uri ?? null,
      verified: token?.is_verified ?? false,
      risk: token?.risk ?? false,
      priceUsd,
      quoteToken: snapshot?.quote_token ?? null,
      volumeUsd,
      authenticity: snapshot
        ? (snapshot.authenticity as DataAuthenticity)
        : DataAuthenticity.UNAVAILABLE,
      volumeAuthenticity,
      source: snapshot?.source ?? null,
      blockNumber: snapshot?.block_number ?? null,
    };
  }

  private sortItems(items: RankingItem[], sort: 'price' | 'volume'): void {
    items.sort((a, b) => {
      if (sort === 'volume') {
        const v = compareDesc(a.volumeUsd, b.volumeUsd);
        if (v !== 0) {
          return v;
        }
      }
      const p = compareDesc(a.priceUsd, b.priceUsd);
      if (p !== 0) {
        return p;
      }
      return (a.symbol ?? '').localeCompare(b.symbol ?? '');
    });
  }

  private resolveSort(sortBy?: RankingSortBy): 'price' | 'volume' {
    // price_change 需历史快照，当前只存最新一条，暂回退为价格降序。
    return sortBy === 'volume' ? 'volume' : 'price';
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
