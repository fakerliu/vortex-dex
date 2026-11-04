import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSupportedChainId } from '../../chain/chain.constants';
import { INDEXER_CHAIN_ID } from '../../indexer/indexer.constants';
import { SwapStatus } from '../swap/swap.types';
import { parseSwapEventData } from '../swap/swap-event.util';
import {
  METRIC_DEFINITIONS,
  type AggregateDailyResultDto,
  type AnalyticsSummaryDto,
  type ChainDto,
  type DailyResultDto,
  type DailyRowDto,
  type PairVolumeDto,
  type PlatformDto,
  type ProtocolDistributionItemDto,
  type ProtocolDistributionResultDto,
  type RevenueDto,
  type TokenVolumeDto,
  type VolumeDto,
} from './analytics.types';

const TOP_N = 20;
const DEFAULT_DAILY_LIMIT = 30;
const MAX_DAILY_LIMIT = 365;
/** 实时回退聚合时扫描 swaps 的上限（避免大表全量拉取）。 */
const DAILY_SCAN_LIMIT = 50_000;
/** 聚合时扫描 swaps 的上限。 */
const AGGREGATE_SCAN_LIMIT = 100_000;
/** USD 计价锚点：Base Mainnet USDC（6 decimals）。 */
const USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
/** USDC decimals（用于标注 volume_usd 原始单位）。 */
const USDC_DECIMALS = 6;

/**
 * 经营分析服务（Sprint 9）。
 *
 * 口径原则：
 * - 量（volume）只反映交易量：笔数 + 原始 token 量；不跨 token 求和、不伪造 USD。
 * - 收入（revenue）与量严格分开；当前 swaps 无 fee 字段、无 USD 预言机 → 置为不可用而非伪造 0。
 * - 每个聚合都对应一条 Prisma 查询，来源可追踪（响应 meta.definitions 声明口径）。
 *
 * 消费全部数据：
 * - swaps          → 平台交易量 / 状态明细 / 去重用户 / token 对聚合
 * - swap_events    → 链上原始事件量与类型明细
 * - users          → 注册用户数
 * - pools          → 已索引池子数
 * - dex_protocols  → 协议数
 * - analytics_daily → daily 接口优先读预聚合表，为空时实时回退到 swaps
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- summary ----------

  async getSummary(chainId?: number): Promise<AnalyticsSummaryDto> {
    this.assertChainIdIfPresent(chainId);
    const swapWhere = this.swapWhere(chainId);
    const confirmedWhere: Prisma.SwapWhereInput = {
      ...swapWhere,
      status: SwapStatus.CONFIRMED,
    };
    // swap_events 无 chain_id 列，仅来自 Indexer（Base Mainnet）。
    const includeChainEvents = chainId === undefined || chainId === INDEXER_CHAIN_ID;

    const [
      statusGroups,
      userGroups,
      byTokenRows,
      byPairRows,
      registeredUsers,
      eventTypeGroups,
      chainTxGroups,
      indexedPools,
      protocols,
    ] = await Promise.all([
      this.prisma.swap.groupBy({
        by: ['status'],
        where: swapWhere,
        _count: { _all: true },
      }),
      this.prisma.swap.groupBy({
        by: ['user_address'],
        where: swapWhere,
      }),
      this.prisma.swap.groupBy({
        by: ['token_in'],
        where: confirmedWhere,
        _sum: { amount_in: true, amount_out: true },
        _count: { _all: true },
      }),
      this.prisma.swap.groupBy({
        by: ['token_in', 'token_out'],
        where: confirmedWhere,
        _sum: { amount_in: true, amount_out: true },
        _count: { _all: true },
      }),
      this.prisma.user.count(),
      includeChainEvents
        ? this.prisma.swapEvent.groupBy({
            by: ['event_type'],
            _count: { _all: true },
          })
        : Promise.resolve([] as { event_type: string; _count: { _all: number } }[]),
      includeChainEvents
        ? this.prisma.swapEvent.groupBy({
            by: ['tx_hash'],
            where: { event_type: 'Swap' },
          })
        : Promise.resolve([] as { tx_hash: string }[]),
      this.prisma.pool.count({ where: this.poolWhere(chainId) }),
      this.prisma.dexProtocol.count({ where: this.protocolWhere(chainId) }),
    ]);

    const statusBreakdown: Record<string, number> = {};
    let totalSwaps = 0;
    for (const g of statusGroups) {
      statusBreakdown[g.status] = g._count._all;
      totalSwaps += g._count._all;
    }
    const confirmed = statusBreakdown[SwapStatus.CONFIRMED] ?? 0;
    const failed =
      (statusBreakdown[SwapStatus.FAILED] ?? 0) +
      (statusBreakdown[SwapStatus.REVERTED] ?? 0);
    const pending = totalSwaps - confirmed - failed;

    const platform: PlatformDto = {
      totalSwaps,
      confirmed,
      pending,
      failed,
      registeredUsers,
      statusBreakdown,
    };

    const volume: VolumeDto = {
      platformSwapCount: confirmed,
      platformUniqueUsers: userGroups.length,
      chainSwapEventCount: includeChainEvents
        ? eventTypeGroups.find((g) => g.event_type === 'Swap')?._count._all ?? 0
        : 0,
      chainUniqueTxs: includeChainEvents ? chainTxGroups.length : 0,
      byToken: this.toTokenVolume(byTokenRows),
      byPair: this.toPairVolume(byPairRows),
    };

    const eventTypeBreakdown: Record<string, number> = {};
    for (const g of eventTypeGroups) {
      eventTypeBreakdown[g.event_type] = g._count._all;
    }

    const chain: ChainDto = {
      eventTypeBreakdown,
      indexedPools,
      protocols,
      note: includeChainEvents
        ? 'swap_events 无 chain_id 列，链上事件仅来自 Indexer（Base Mainnet 8453）。'
        : `当前 chainId=${chainId} 无 Indexer 链上事件（仅 Base Mainnet 8453 被索引）。`,
    };

    const revenue: RevenueDto = {
      available: false,
      definition: METRIC_DEFINITIONS.find((d) => d.key === 'revenue')?.definition ?? '',
      note:
        '量（volume）与收入（revenue）必须分开：volume 只反映交易量（笔数 + 原始 token 量），' +
        'revenue 反映可确收的协议手续费。当前 swaps 表无 fee / protocol_fee 字段，且无 USD 价格预言机，' +
        '故 revenue 置为不可用（available=false），不伪造 0 值。',
    };

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      volume,
      revenue,
      platform,
      chain,
      definitions: METRIC_DEFINITIONS,
    };
  }

  // ---------- daily ----------

  async getDaily(
    chainId?: number,
    from?: string,
    to?: string,
    limit?: number,
  ): Promise<DailyResultDto> {
    this.assertChainIdIfPresent(chainId);
    const fromDate = this.normalizeDate(from, 'from');
    const toDate = this.normalizeDate(to, 'to');
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('from 不能晚于 to');
    }
    const l = this.normalizeLimit(limit);

    // 1) 优先读预聚合表 analytics_daily（日期是字符串，字典序即时间序）
    const cachedWhere: Prisma.AnalyticsDailyWhereInput = {
      ...(chainId !== undefined ? { chain_id: chainId } : {}),
      ...(fromDate ? { date: { gte: fromDate } } : {}),
      ...(toDate ? { date: { lte: toDate } } : {}),
    };
    const cached = await this.prisma.analyticsDaily.findMany({
      where: cachedWhere,
      orderBy: [{ date: 'desc' }, { chain_id: 'asc' }],
      take: l,
    });

    if (cached.length > 0) {
      const rows: DailyRowDto[] = cached.map((r) => ({
        date: r.date,
        chainId: r.chain_id,
        swapCount: r.swap_count,
        uniqueUsers: r.unique_users,
        confirmedSwaps: null, // analytics_daily 未单列 confirmed，见 summary 的 confirmed/total
        volumeUsd: r.volume_usd.toString(),
        platformRevenueUsd: r.platform_revenue_usd.toString(),
        source: 'analytics_daily',
      }));
      return {
        generatedAt: new Date().toISOString(),
        chainId: chainId ?? null,
        from: fromDate,
        to: toDate,
        rows,
        note:
          '数据来源 analytics_daily 预聚合表（POST /analytics/aggregate 落库）。' +
          'volume_usd 为 USDC 计价原始金额（6 decimals，≈USD×1e6）；' +
          'platform_revenue_usd=0（首期无收费机制，如实 0，非占位）；' +
          'confirmedSwaps 未在 analytics_daily 单列，请以 summary 的 confirmed/total 为准。',
      };
    }

    // 2) 回退：实时从 swaps 按天聚合（内存分组，扫描上限 DAILY_SCAN_LIMIT）
    const swapWhere: Prisma.SwapWhereInput = {
      ...(chainId !== undefined ? { chain_id: chainId } : {}),
      ...(fromDate || toDate
        ? {
            created_at: {
              ...(fromDate ? { gte: this.startOfDay(fromDate) } : {}),
              ...(toDate ? { lt: this.nextDay(toDate) } : {}),
            },
          }
        : {}),
    };
    const swaps = await this.prisma.swap.findMany({
      where: swapWhere,
      select: {
        created_at: true,
        user_address: true,
        status: true,
        chain_id: true,
      },
      orderBy: { created_at: 'asc' },
      take: DAILY_SCAN_LIMIT,
    });

    const byKey = new Map<
      string,
      { date: string; chainId: number; users: Set<string>; total: number; confirmed: number }
    >();
    for (const s of swaps) {
      const date = s.created_at.toISOString().slice(0, 10);
      const key = `${date}_${s.chain_id}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { date, chainId: s.chain_id, users: new Set(), total: 0, confirmed: 0 };
        byKey.set(key, agg);
      }
      agg.total += 1;
      agg.users.add(s.user_address);
      if (s.status === SwapStatus.CONFIRMED) {
        agg.confirmed += 1;
      }
    }

    const rows: DailyRowDto[] = [...byKey.values()]
      .sort((a, b) => b.date.localeCompare(a.date) || a.chainId - b.chainId)
      .slice(0, l)
      .map((agg) => ({
        date: agg.date,
        chainId: agg.chainId,
        swapCount: agg.total,
        uniqueUsers: agg.users.size,
        confirmedSwaps: agg.confirmed,
        volumeUsd: null,
        platformRevenueUsd: null,
        source: 'swaps',
      }));

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      from: fromDate,
      to: toDate,
      rows,
      note:
        'analytics_daily 预聚合表无匹配数据（表为空或过滤后无结果），实时回退到 swaps 表按天聚合（无 USD，volumeUsd/platformRevenueUsd 为 null）。' +
        '该回退仅统计平台交易，不含链上原始 swap_events。',
    };
  }

  // ---------- 日聚合落库（幂等） ----------

  /**
   * 将 swaps 表按天聚合，幂等 upsert 到 analytics_daily（@@unique([date, chain_id])）。
   *
   * volume_usd 口径：仅统计 status=CONFIRMED 且 token_in 或 token_out 为 USDC 的交易，
   * 取 USDC 侧原始数量（6 decimals）作为「USD 代理值」（USDC≈1 USD），绝不编造非 USDC 汇率。
   * 不含 USDC 的已确认交易计入 unpricedSwaps，不计入 volume_usd。
   * platform_revenue_usd / platform_cost_usd 如实置 0（VORTEX 首期无收费机制）。
   */
  async aggregateDaily(
    chainId?: number,
    from?: string,
    to?: string,
  ): Promise<AggregateDailyResultDto> {
    this.assertChainIdIfPresent(chainId);
    const fromDate = this.normalizeDate(from, 'from');
    const toDate = this.normalizeDate(to, 'to');
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('from 不能晚于 to');
    }

    const where: Prisma.SwapWhereInput = {
      ...(chainId !== undefined ? { chain_id: chainId } : {}),
      ...(fromDate || toDate
        ? {
            created_at: {
              ...(fromDate ? { gte: this.startOfDay(fromDate) } : {}),
              ...(toDate ? { lt: this.nextDay(toDate) } : {}),
            },
          }
        : {}),
    };

    const swaps = await this.prisma.swap.findMany({
      where,
      select: {
        chain_id: true,
        user_address: true,
        status: true,
        token_in: true,
        token_out: true,
        amount_in: true,
        amount_out: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
      take: AGGREGATE_SCAN_LIMIT,
    });

    interface DayAgg {
      date: string;
      chainId: number;
      users: Set<string>;
      total: number;
      confirmed: number;
      unpriced: number;
      volumeUsd: bigint;
    }
    const byKey = new Map<string, DayAgg>();
    let confirmedSwaps = 0;

    for (const s of swaps) {
      const date = s.created_at.toISOString().slice(0, 10);
      const key = `${date}_${s.chain_id}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = {
          date,
          chainId: s.chain_id,
          users: new Set<string>(),
          total: 0,
          confirmed: 0,
          unpriced: 0,
          volumeUsd: 0n,
        };
        byKey.set(key, agg);
      }
      agg.total += 1;
      agg.users.add(s.user_address);
      if (s.status !== SwapStatus.CONFIRMED) {
        continue;
      }
      agg.confirmed += 1;
      confirmedSwaps += 1;

      const usdRaw = this.usdcSideRaw(
        s.token_in,
        s.token_out,
        s.amount_in,
        s.amount_out,
      );
      if (usdRaw !== null) {
        agg.volumeUsd += usdRaw;
      } else {
        agg.unpriced += 1;
      }
    }

    const d = (v: bigint): Prisma.Decimal => new Prisma.Decimal(v.toString());
    let upsertedRows = 0;
    for (const agg of byKey.values()) {
      await this.prisma.analyticsDaily.upsert({
        where: { date_chain_id: { date: agg.date, chain_id: agg.chainId } },
        update: {
          volume_usd: d(agg.volumeUsd),
          swap_count: agg.total,
          unique_users: agg.users.size,
          platform_revenue_usd: d(0n),
          platform_cost_usd: d(0n),
        },
        create: {
          date: agg.date,
          chain_id: agg.chainId,
          volume_usd: d(agg.volumeUsd),
          swap_count: agg.total,
          unique_users: agg.users.size,
          platform_revenue_usd: d(0n),
          platform_cost_usd: d(0n),
        },
      });
      upsertedRows += 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      from: fromDate,
      to: toDate,
      aggregatedDates: byKey.size,
      upsertedRows,
      totalSwapsScanned: swaps.length,
      confirmedSwaps,
      unpricedSwaps: [...byKey.values()].reduce((sum, a) => sum + a.unpriced, 0),
      note:
        `volume_usd 仅统计 CONFIRMED 且含 USDC 的交易，取 USDC 侧原始数量（${USDC_DECIMALS} decimals）≈ USD×1e${USDC_DECIMALS}；` +
        'platform_revenue_usd / platform_cost_usd 如实置 0（VORTEX 首期无收费机制，不伪造）。',
    };
  }

  /** 返回某笔交易的 USDC 侧原始数量（作为 USD 代理值）；无 USDC 侧则返回 null。 */
  private usdcSideRaw(
    tokenIn: string,
    tokenOut: string,
    amountIn: Prisma.Decimal,
    amountOut: Prisma.Decimal,
  ): bigint | null {
    if (tokenIn.toLowerCase() === USDC_ADDRESS) {
      return BigInt(amountIn.toString());
    }
    if (tokenOut.toLowerCase() === USDC_ADDRESS) {
      return BigInt(amountOut.toString());
    }
    return null;
  }

  // ---------- 小时聚合落库（幂等，第四步） ----------

  /**
   * 将 swaps + quotes 按小时聚合，幂等 upsert 到 analytics_hourly（@@unique([hour, chain_id])）。
   *
   * 口径：
   * - swap_count：该小时 swaps 总数（全状态）
   * - confirmed_swaps：status=CONFIRMED
   * - failed_swaps：status=FAILED + REVERTED
   * - unique_users：去重 user_address
   * - quote_count：该小时 quotes 总数
   * - volume_usd：仅 CONFIRMED 且含 USDC 的交易，取 USDC 侧原始数量（6 decimals）
   */
  async aggregateHourly(
    chainId?: number,
    from?: string,
    to?: string,
  ): Promise<{ generatedAt: string; chainId: number | null; hours: number; upsertedRows: number; note: string }> {
    this.assertChainIdIfPresent(chainId);
    const fromDate = this.normalizeDate(from, 'from');
    const toDate = this.normalizeDate(to, 'to');
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('from 不能晚于 to');
    }

    const swapWhere: Prisma.SwapWhereInput = {
      ...(chainId !== undefined ? { chain_id: chainId } : {}),
      ...(fromDate || toDate
        ? {
            created_at: {
              ...(fromDate ? { gte: this.startOfDay(fromDate) } : {}),
              ...(toDate ? { lt: this.nextDay(toDate) } : {}),
            },
          }
        : {}),
    };

    const swaps = await this.prisma.swap.findMany({
      where: swapWhere,
      select: {
        chain_id: true,
        user_address: true,
        status: true,
        token_in: true,
        token_out: true,
        amount_in: true,
        amount_out: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    });

    const quotes = await this.prisma.quote.findMany({
      where: {
        ...(chainId !== undefined ? { chain_id: chainId } : {}),
        ...(fromDate || toDate
          ? {
              created_at: {
                ...(fromDate ? { gte: this.startOfDay(fromDate) } : {}),
                ...(toDate ? { lt: this.nextDay(toDate) } : {}),
              },
            }
          : {}),
      },
      select: { chain_id: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });

    interface HourAgg {
      hour: string;
      chainId: number;
      users: Set<string>;
      swapCount: number;
      confirmed: number;
      failed: number;
      quoteCount: number;
      volumeUsd: bigint;
    }
    const byKey = new Map<string, HourAgg>();

    const hourOf = (d: Date): string => d.toISOString().slice(0, 13); // YYYY-MM-DDTHH

    for (const s of swaps) {
      const hour = hourOf(s.created_at);
      const key = `${hour}_${s.chain_id}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { hour, chainId: s.chain_id, users: new Set(), swapCount: 0, confirmed: 0, failed: 0, quoteCount: 0, volumeUsd: 0n };
        byKey.set(key, agg);
      }
      agg.swapCount += 1;
      agg.users.add(s.user_address);
      if (s.status === SwapStatus.CONFIRMED) {
        agg.confirmed += 1;
        const usdRaw = this.usdcSideRaw(s.token_in, s.token_out, s.amount_in, s.amount_out);
        if (usdRaw !== null) {
          agg.volumeUsd += usdRaw;
        }
      } else if (s.status === SwapStatus.FAILED || s.status === SwapStatus.REVERTED) {
        agg.failed += 1;
      }
    }

    for (const q of quotes) {
      const hour = hourOf(q.created_at);
      const key = `${hour}_${q.chain_id}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { hour, chainId: q.chain_id, users: new Set(), swapCount: 0, confirmed: 0, failed: 0, quoteCount: 0, volumeUsd: 0n };
        byKey.set(key, agg);
      }
      agg.quoteCount += 1;
    }

    const d = (v: bigint): Prisma.Decimal => new Prisma.Decimal(v.toString());
    for (const agg of byKey.values()) {
      // hour 存为 "YYYY-MM-DD HH"（空格分隔，便于人读与字典序）
      const hourKey = agg.hour.replace('T', ' ');
      await this.prisma.analyticsHourly.upsert({
        where: { hour_chain_id: { hour: hourKey, chain_id: agg.chainId } },
        update: {
          swap_count: agg.swapCount,
          confirmed_swaps: agg.confirmed,
          failed_swaps: agg.failed,
          unique_users: agg.users.size,
          quote_count: agg.quoteCount,
          volume_usd: d(agg.volumeUsd),
        },
        create: {
          hour: hourKey,
          chain_id: agg.chainId,
          swap_count: agg.swapCount,
          confirmed_swaps: agg.confirmed,
          failed_swaps: agg.failed,
          unique_users: agg.users.size,
          quote_count: agg.quoteCount,
          volume_usd: d(agg.volumeUsd),
        },
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      hours: byKey.size,
      upsertedRows: byKey.size,
      note:
        '按小时聚合 swaps + quotes 到 analytics_hourly（幂等）。volume_usd 仅含 CONFIRMED 且含 USDC 的交易（USDC 侧 6 decimals ≈ USD×1e6）。',
    };
  }

  /** 小时级统计查询（预聚合优先，实时回退）。 */
  async getHourly(
    chainId?: number,
    limit?: number,
  ): Promise<{ generatedAt: string; chainId: number | null; rows: unknown[]; note: string }> {
    this.assertChainIdIfPresent(chainId);
    const l = this.normalizeLimit(limit);
    const rows = await this.prisma.analyticsHourly.findMany({
      where: chainId !== undefined ? { chain_id: chainId } : {},
      orderBy: [{ hour: 'desc' }, { chain_id: 'asc' }],
      take: l,
    });
    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      rows: rows.map((r) => ({
        hour: r.hour,
        chainId: r.chain_id,
        swapCount: r.swap_count,
        confirmedSwaps: r.confirmed_swaps,
        failedSwaps: r.failed_swaps,
        uniqueUsers: r.unique_users,
        quoteCount: r.quote_count,
        volumeUsd: r.volume_usd.toString(),
      })),
      note: '数据来源 analytics_hourly 预聚合表（POST /analytics/aggregate-hourly 落库）。',
    };
  }

  // ---------- 协议分布 ----------

  /** 各协议（aerodrome_classic / aerodrome_cl）交易量分布，来自 swap_events 原始事件。 */
  async getProtocolDistribution(
    chainId?: number,
  ): Promise<ProtocolDistributionResultDto> {
    this.assertChainIdIfPresent(chainId);
    const includeChainEvents = chainId === undefined || chainId === INDEXER_CHAIN_ID;
    if (!includeChainEvents) {
      return {
        generatedAt: new Date().toISOString(),
        chainId: chainId ?? null,
        items: [],
        note: `当前 chainId=${chainId} 无 Indexer 链上事件（仅 Base Mainnet 8453 被索引）。`,
      };
    }

    const events = await this.prisma.swapEvent.findMany({
      where: { event_type: 'Swap' },
      select: { tx_hash: true, event_data: true },
    });

    const byProtocol = new Map<string, { txs: Set<string>; events: number }>();
    for (const e of events) {
      const parsed = parseSwapEventData(e.event_data);
      const proto = parsed.protocolType || 'unknown';
      let agg = byProtocol.get(proto);
      if (!agg) {
        agg = { txs: new Set<string>(), events: 0 };
        byProtocol.set(proto, agg);
      }
      agg.events += 1;
      agg.txs.add(e.tx_hash);
    }

    const items: ProtocolDistributionItemDto[] = [...byProtocol.entries()]
      .map(([protocolType, agg]) => ({
        protocolType,
        swapEvents: agg.events,
        uniqueTxs: agg.txs.size,
      }))
      .sort((a, b) => b.swapEvents - a.swapEvents);

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      items,
      note:
        '协议分布来自 swap_events.event_data.protocolType（Indexer 落库，Base Mainnet 8453），按 Swap 事件条数降序。',
    };
  }

  // ---------- 私有 ----------

  private swapWhere(chainId?: number): Prisma.SwapWhereInput {
    return chainId !== undefined ? { chain_id: chainId } : {};
  }

  private poolWhere(chainId?: number): Prisma.PoolWhereInput {
    return chainId !== undefined ? { chain_id: chainId } : {};
  }

  private protocolWhere(chainId?: number): Prisma.DexProtocolWhereInput {
    return chainId !== undefined ? { chain_id: chainId } : {};
  }

  private toTokenVolume(
    rows: {
      token_in: string;
      _sum: { amount_in: Prisma.Decimal | null; amount_out: Prisma.Decimal | null };
      _count: { _all: number };
    }[],
  ): TokenVolumeDto[] {
    return rows
      .map((r) => ({
        token: r.token_in,
        amountIn: r._sum.amount_in?.toString() ?? '0',
        amountOut: r._sum.amount_out?.toString() ?? '0',
        swaps: r._count._all,
      }))
      .sort((a, b) => b.swaps - a.swaps)
      .slice(0, TOP_N);
  }

  private toPairVolume(
    rows: {
      token_in: string;
      token_out: string;
      _sum: { amount_in: Prisma.Decimal | null; amount_out: Prisma.Decimal | null };
      _count: { _all: number };
    }[],
  ): PairVolumeDto[] {
    return rows
      .map((r) => ({
        tokenIn: r.token_in,
        tokenOut: r.token_out,
        amountIn: r._sum.amount_in?.toString() ?? '0',
        amountOut: r._sum.amount_out?.toString() ?? '0',
        swaps: r._count._all,
      }))
      .sort((a, b) => b.swaps - a.swaps)
      .slice(0, TOP_N);
  }

  private assertChainIdIfPresent(chainId?: number): void {
    if (chainId !== undefined && !isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
  }

  private normalizeDate(value: string | undefined, label: string): string | null {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }
    const s = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      throw new BadRequestException(`${label} 必须是 YYYY-MM-DD 格式（收到 ${value}）`);
    }
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      throw new BadRequestException(`${label} 不是合法日期（收到 ${value}）`);
    }
    return s;
  }

  private startOfDay(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
  }

  private nextDay(date: string): Date {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  private normalizeLimit(limit?: number): number {
    const l = limit ?? DEFAULT_DAILY_LIMIT;
    if (!Number.isInteger(l) || l < 1) {
      throw new BadRequestException('limit 必须是 >= 1 的整数');
    }
    return Math.min(l, MAX_DAILY_LIMIT);
  }
}
