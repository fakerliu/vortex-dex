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
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { findBlockByTimestamp } from '../../chain/block-time';
import { deriveSwapDirection, parseSwapEventData } from '../swap/swap-event.util';
import { MarketService } from './market.service';
import type { RankingItem, RankingResult, RankingSortBy } from './market.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** 成交量统计窗口：近 24h。 */
const VOLUME_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 定点小数精度（与 dex/math 的 parseDecimal / formatUnits 一致，18 位）。 */
const PRICE_SCALE = 18n;
/** 24h 边界块的缓存时长（毫秒）。Base 约 2s/块，60s 内边界块漂移 ≤ 30 块，可忽略。 */
const BLOCK_BOUNDARY_CACHE_MS = 60 * 1000;
/** swap_events 游标分页的每页条数。 */
const SWAP_EVENT_PAGE_SIZE = 5000;

/**
 * Prisma.Decimal -> 干净十进制字符串（去尾零），null 透传。
 *
 * 注意：Decimal.toString() 对极小值（< 1e-7）会输出科学计数法（如
 * "8.15681901e-10"），下游 parseDecimal 的 BigInt() 无法解析，导致
 * "Cannot convert ... to a BigInt" 崩溃。这里改用 toFixed() 强制输出
 * 固定十进制（绝不产生科学计数法），再去除尾零。
 */
function decimalToString(d: Prisma.Decimal | null | undefined): string | null {
  if (d == null) {
    return null;
  }
  let s = d.toFixed();
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
 * 只读聚合，不推导价格（仅成交量边界块需读一次链上时间戳做二分，结果缓存）：
 * - 价格：取 market_snapshots 该链最新快照（price_usd / quote_token /
 *   block_number / authenticity / source）。
 * - 元数据：join Token 表拿 symbol / name / logo / verified / risk。
 * - 成交量：从 swap_events 按 tokenOut 聚合近 24h 的 amountOut，再按该 token
 *   价格换算为 USD（volumeUsd）。swap_events 无数据则如实返回 0，不编造。
 *
 * 榜单基集 = Token 注册表 ∪ 快照表。无快照的 token 仍返回（priceUsd=null +
 * authenticity=UNAVAILABLE），不丢弃。
 *
 * 排序：
 * - 默认（未传 sortBy）按 priceUsd 降序。
 * - sortBy=volume 按 volumeUsd 降序（tie-break 价格降序再 symbol 升序）。
 * - sortBy=price_change 按 priceChange 降序（tie-break 价格降序再 symbol 升序）。
 *   priceChange 由「最新快照 vs 最近前一条快照」定点计算，缺任一快照为 null。
 */
@Injectable()
export class MarketRankingService {
  private readonly logger = new Logger(MarketRankingService.name);
  /** 24h 边界块缓存（key=chainId），避免每次请求都做 ~26 次 getBlock 二分。 */
  private readonly blockBoundaryCache = new Map<
    number,
    { value: number; at: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketService: MarketService,
    private readonly rpc: ChainRpcService,
  ) {}

  async getRanking(
    chainId: number | undefined,
    sortBy?: RankingSortBy,
    limit?: number,
    q?: string,
    page?: number,
  ): Promise<RankingResult> {
    const resolvedChainId = this.resolveChainId(chainId);
    const resolvedLimit = this.normalizeLimit(limit);
    const effectiveSort = this.resolveSort(sortBy);
    const resolvedPage = this.normalizePage(page);
    const query = this.normalizeQuery(q);

    // 模糊搜索：symbol / name / address 大小写不敏感（Prisma 5.22 支持 mode）。
    const tokenWhere: Prisma.TokenWhereInput = { chain_id: resolvedChainId };
    if (query !== undefined) {
      tokenWhere.OR = [
        { symbol: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
        { address: { contains: query, mode: 'insensitive' } },
      ];
    }

    const [tokens, snapshots, volumeMap] = await Promise.all([
      this.prisma.token.findMany({ where: tokenWhere }),
      this.prisma.marketSnapshot.findMany({
        where: { chain_id: resolvedChainId },
        orderBy: [{ token_address: 'asc' }, { created_at: 'desc' }],
      }),
      this.aggregateVolume(resolvedChainId),
    ]);

    const tokenByAddr = new Map<string, Token>(
      tokens.map((t) => [t.address, t]),
    );
    // 每个 token 保留最新一条作为展示快照，最近的前一条作为涨跌幅对比基准。
    const latestByAddr = new Map<string, MarketSnapshot>();
    const prevByAddr = new Map<string, MarketSnapshot>();
    for (const s of snapshots) {
      if (!latestByAddr.has(s.token_address)) {
        latestByAddr.set(s.token_address, s);
      } else if (!prevByAddr.has(s.token_address)) {
        prevByAddr.set(s.token_address, s);
      }
    }

    // 基集：Token 注册表（已按 q 过滤）∪ 快照表，确保无快照 token 也返回。
    const addresses = new Set<string>([
      ...tokenByAddr.keys(),
      ...latestByAddr.keys(),
    ]);

    // 快照表中可能存在「无 Token 注册记录」的地址，此时仅能按地址匹配 q。
    if (query !== undefined) {
      const needle = query.toLowerCase();
      for (const address of addresses) {
        if (tokenByAddr.has(address)) {
          continue; // 已在 Prisma 层按 symbol/name/address 过滤
        }
        if (!address.includes(needle)) {
          addresses.delete(address);
        }
      }
    }

    const items: RankingItem[] = [];
    for (const address of addresses) {
      items.push(
        this.buildItem(
          resolvedChainId,
          address,
          tokenByAddr.get(address),
          latestByAddr.get(address),
          prevByAddr.get(address),
          volumeMap,
        ),
      );
    }

    this.sortItems(items, effectiveSort);

    const skip = (resolvedPage - 1) * resolvedLimit;
    const pageItems = items.slice(skip, skip + resolvedLimit);

    // 治标：无快照的币在排序阶段无价格排最后，这里只对当前页 slice 出来的
    // 那些无价格项做实时查价（最多 limit 个），避免串行查全部 195 个打爆 RPC。
    await this.enrichMissingPrices(resolvedChainId, pageItems);

    return {
      chainId: resolvedChainId,
      sortBy: effectiveSort,
      limit: resolvedLimit,
      total: items.length,
      items: pageItems,
    };
  }

  // ---------- 私有工具 ----------

  /** 聚合近 24h 各 token 的 amount_out 原始大整数（读 swap_events）；失败返回 null（如实降级）。 */
  private async aggregateVolume(
    chainId: number,
  ): Promise<Map<string, bigint> | null> {
    return this.aggregateVolumeFromEvents(chainId);
  }

  /**
   * 从 swap_events 聚合近 24h 成交量（D6：仅按 amountOut 记一次，不重复归因）。
   *
   * 数据流：swap_events(event_type='Swap' & block_number >= 24h 边界块)
   *         → parseSwapEventData 解析 event_data JSON
   *         → 按 event_data.pool(小写) join pools 拿 token0/token1
   *         → deriveSwapDirection 统一 CL/classic → tokenOut/amountOut
   *         → 按 tokenOut 累加 amountOut（链上原始大整数）。
   *
   * 说明：
   * - 近 24h 用「区块号」而非 created_at（created_at 是索引时间，D4 零迁移）。
   * - swap_events 无 chain_id，靠 join pools(chain_id=8453) 隐式限定链。
   * - event_data 只有 pool(小写)/poolId，token 信息来自 pools 表。
   */
  private async aggregateVolumeFromEvents(
    chainId: number,
  ): Promise<Map<string, bigint> | null> {
    const boundary = await this.resolveBlockForTimestamp(
      chainId,
      Date.now() - VOLUME_WINDOW_MS,
    );
    if (boundary === null) {
      this.logger.warn(
        `无法解析近 24h 边界块（chain=${chainId}），成交量降级为 UNAVAILABLE`,
      );
      return null;
    }

    try {
      // join 用 pool_address（event_data.pool 为小写地址，poolId 在 JSON 内无法走索引）。
      const pools = await this.prisma.pool.findMany({
        where: { chain_id: chainId },
        select: { pool_address: true, token0_address: true, token1_address: true },
      });
      const tokenByPool = new Map<string, [string, string]>(
        pools.map((p) => [
          p.pool_address,
          [p.token0_address, p.token1_address],
        ]),
      );

      const map = new Map<string, bigint>();
      let cursor: string | undefined;
      while (true) {
        const rows = await this.prisma.swapEvent.findMany({
          where: {
            event_type: 'Swap',
            block_number: { gte: boundary },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: SWAP_EVENT_PAGE_SIZE,
          select: { id: true, event_data: true },
        });
        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const ev = parseSwapEventData(row.event_data);
          const tokens = tokenByPool.get(ev.pool);
          if (!tokens) {
            continue; // 池子不在本链 pools 表（或已删除），跳过
          }
          const dir = deriveSwapDirection(ev, tokens[0], tokens[1]);
          if (!dir) {
            continue;
          }
          let amountOut: bigint;
          try {
            amountOut = BigInt(dir.amountOut);
          } catch {
            continue;
          }
          if (amountOut <= 0n) {
            continue;
          }
          const out = normalizeAddress(dir.tokenOut);
          map.set(out, (map.get(out) ?? 0n) + amountOut);
        }

        cursor = rows[rows.length - 1].id;
        if (rows.length < SWAP_EVENT_PAGE_SIZE) {
          break;
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `swap_events 成交量聚合失败（chain=${chainId}）: ${this.errMsg(err)}`,
      );
      return null;
    }
  }

  /**
   * 解析某时间戳对应的链上区块号（D4 零迁移）。
   * 最新块 timestamp 已知后，用 findBlockByTimestamp 二分得到边界块；
   * 结果缓存 60s（Base 出块约 2s，窗口漂移 ≤ 30 块，对 24h 成交量误差可忽略）。
   */
  private async resolveBlockForTimestamp(
    chainId: number,
    tsMs: number,
  ): Promise<number | null> {
    const targetTs = Math.floor(tsMs / 1000);
    const cached = this.blockBoundaryCache.get(chainId);
    if (cached && Date.now() - cached.at < BLOCK_BOUNDARY_CACHE_MS) {
      return cached.value;
    }

    try {
      const client = this.rpc.getClient(chainId);
      const boundary = await findBlockByTimestamp(client, targetTs);
      this.blockBoundaryCache.set(chainId, { value: boundary, at: Date.now() });
      return boundary;
    } catch (err) {
      this.logger.warn(
        `解析区块时间边界失败（chain=${chainId}）: ${this.errMsg(err)}`,
      );
      return null;
    }
  }

  /**
   * 对当前页中无价格的项做实时兜底（链上报价 → CoinGecko，复用 MarketService）。
   * 并发分块（每块 5 个），避免同时打爆 RPC / CoinGecko 免费档。查到的价格
   * 落库快照（append-only），减少下次请求重复查询；单项失败静默降级。
   */
  private async enrichMissingPrices(
    chainId: number,
    items: RankingItem[],
  ): Promise<void> {
    const missing = items.filter((it) => it.priceUsd === null);
    if (missing.length === 0) {
      return;
    }

    const CONCURRENCY = 5;
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const chunk = missing.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map((item) => this.enrichOne(chainId, item)),
      );
    }
  }

  private async enrichOne(
    chainId: number,
    item: RankingItem,
  ): Promise<void> {
    try {
      const price = await this.marketService.getTokenPrice(
        chainId,
        item.address,
      );
      item.priceUsd = price.priceUsd;
      item.quoteToken = price.quoteToken;
      item.authenticity = price.authenticity;
      item.source = price.source;
      item.blockNumber = price.blockNumber;

      // 落库（失败内部已吞掉，不抛错），减少下次请求重复查询。
      await this.marketService.persistPriceSnapshot(
        chainId,
        item.address,
        price,
        item.symbol ?? item.address,
      );
    } catch (err) {
      this.logger.warn(
        `榜单实时价格兜底失败（${item.symbol ?? item.address}）: ${this.errMsg(err)}`,
      );
    }
  }

  private buildItem(
    chainId: number,
    address: string,
    token: Token | undefined,
    snapshot: MarketSnapshot | undefined,
    prevSnapshot: MarketSnapshot | undefined,
    volumeMap: Map<string, bigint> | null,
  ): RankingItem {
    const priceUsd = snapshot ? decimalToString(snapshot.price_usd) : null;
    const priceChange = this.computePriceChange(
      snapshot?.price_usd ?? null,
      prevSnapshot?.price_usd ?? null,
    );
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
      priceChange,
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

  /**
   * 涨跌幅 = (latest - prev) / prev，纯 BigInt 定点运算（18 位精度）。
   * 缺任一价格或 prev 为零 → null。结果保留为可正可负的十进制字符串。
   */
  private computePriceChange(
    latest: Prisma.Decimal | null | undefined,
    prev: Prisma.Decimal | null | undefined,
  ): string | null {
    if (latest == null || prev == null) {
      return null;
    }
    const prevFixed = parseDecimal(prev.toString(), PRICE_SCALE);
    if (prevFixed === 0n) {
      return null;
    }
    const latestFixed = parseDecimal(latest.toString(), PRICE_SCALE);
    const diff = latestFixed - prevFixed;
    const ratio = (diff * 10n ** PRICE_SCALE) / prevFixed;
    return formatUnits(ratio.toString(), Number(PRICE_SCALE));
  }

  private sortItems(
    items: RankingItem[],
    sort: 'price' | 'volume' | 'price_change',
  ): void {
    items.sort((a, b) => {
      if (sort === 'volume') {
        const v = compareDesc(a.volumeUsd, b.volumeUsd);
        if (v !== 0) {
          return v;
        }
      } else if (sort === 'price_change') {
        const pc = compareDesc(a.priceChange, b.priceChange);
        if (pc !== 0) {
          return pc;
        }
      }
      const p = compareDesc(a.priceUsd, b.priceUsd);
      if (p !== 0) {
        return p;
      }
      return (a.symbol ?? '').localeCompare(b.symbol ?? '');
    });
  }

  private resolveSort(
    sortBy?: RankingSortBy,
  ): 'price' | 'volume' | 'price_change' {
    if (sortBy === 'volume') {
      return 'volume';
    }
    if (sortBy === 'price_change') {
      return 'price_change';
    }
    return 'price';
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

  private normalizePage(page?: number): number {
    if (page === undefined) {
      return 1;
    }
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page 必须是 >= 1 的整数');
    }
    return page;
  }

  /** 搜索词：trim 后空串视作未传，避免空 contains 匹配全部。 */
  private normalizeQuery(q?: string): string | undefined {
    if (q === undefined) {
      return undefined;
    }
    const trimmed = q.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
