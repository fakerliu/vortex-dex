import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSupportedChainId } from '../../chain/chain.constants';
import { INDEXER_CHAIN_ID } from '../../indexer/indexer.constants';
import { SwapStatus } from '../swap/swap.types';

/**
 * 核心 Dashboard 数据服务（Analytics 第五步）。
 *
 * 提供 Overview / Trading / Users / Funnel 四类聚合查询。
 * 金额铁律：链上原始大整数一律字符串；禁 Float。
 * 口径与 metrics-dictionary.md 对齐。
 */

const TOP_N = 20;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Overview ----------

  async getOverview(chainId?: number) {
    this.assertChainIdIfPresent(chainId);
    const where: Prisma.SwapWhereInput = chainId !== undefined ? { chain_id: chainId } : {};

    const [totalSwaps, confirmedSwaps, failedSwaps, uniqueUsers, newUsers24h, totalVolume] =
      await Promise.all([
        this.prisma.swap.count({ where }),
        this.prisma.swap.count({ where: { ...where, status: SwapStatus.CONFIRMED } }),
        this.prisma.swap.count({
          where: {
            ...where,
            status: { in: [SwapStatus.FAILED, SwapStatus.REVERTED] },
          },
        }),
        this.prisma.swap.groupBy({ by: ['user_address'], where }).then((g) => g.length),
        this.prisma.swap
          .findMany({
            where: {
              ...where,
              created_at: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
            },
            select: { user_address: true },
          })
          .then((rows) => new Set(rows.map((r) => r.user_address)).size),
        this.confirmedUsdVolume(where),
      ]);

    const successRate =
      confirmedSwaps + failedSwaps > 0
        ? ((confirmedSwaps / (confirmedSwaps + failedSwaps)) * 100).toFixed(2)
        : '0';

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      totalSwaps,
      confirmedSwaps,
      failedSwaps,
      uniqueUsers,
      activeWallets24h: newUsers24h,
      successRate,
      volumeUsd: totalVolume,
      note: 'volumeUsd 仅含 CONFIRMED 且含 USDC 的交易（USDC 侧 6 decimals ≈ USD×1e6），非 USDC 对未计价。',
    };
  }

  // ---------- Trading ----------

  async getTrading(chainId?: number, from?: string, to?: string) {
    this.assertChainIdIfPresent(chainId);
    const where: Prisma.SwapWhereInput = {
      ...(chainId !== undefined ? { chain_id: chainId } : {}),
      ...(from || to
        ? {
            created_at: {
              ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
              ...(to ? { lt: new Date(`${to}T23:59:59Z`) } : {}),
            },
          }
        : {}),
    };

    const statusGroups = await this.prisma.swap.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const byPair = await this.prisma.swap.groupBy({
      by: ['token_in', 'token_out'],
      where: { ...where, status: SwapStatus.CONFIRMED },
      _count: { _all: true },
      _sum: { amount_in: true, amount_out: true },
    });

    const statusBreakdown: Record<string, number> = {};
    for (const g of statusGroups) {
      statusBreakdown[g.status] = g._count._all;
    }

    const topPairs = byPair
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, TOP_N)
      .map((r) => ({
        tokenIn: r.token_in,
        tokenOut: r.token_out,
        swaps: r._count._all,
        amountIn: r._sum?.amount_in?.toString() ?? '0',
        amountOut: r._sum?.amount_out?.toString() ?? '0',
      }));

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      statusBreakdown,
      topPairs,
    };
  }

  // ---------- Users ----------

  async getUsers(chainId?: number) {
    this.assertChainIdIfPresent(chainId);
    const where: Prisma.SwapWhereInput = chainId !== undefined ? { chain_id: chainId } : {};

    const [totalUsers, tradesPerWallet] = await Promise.all([
      this.prisma.swap.groupBy({ by: ['user_address'], where }).then((g) => g.length),
      this.prisma.swap.groupBy({
        by: ['user_address'],
        where,
        _count: { _all: true },
      }),
    ]);

    const topWallets = tradesPerWallet
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, TOP_N)
      .map((r) => ({
        wallet: r.user_address,
        swaps: r._count._all,
      }));

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      totalUsers,
      topWallets,
    };
  }

  // ---------- Funnel ----------

  async getFunnel(chainId?: number) {
    this.assertChainIdIfPresent(chainId);
    // 漏斗基于 analytics_events / analytics_funnel_events（第三步采集）
    const [eventCounts, funnelCounts] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ['event_name'],
        _count: { _all: true },
      }),
      this.prisma.analyticsFunnelEvent.groupBy({
        by: ['step_name'],
        _count: { _all: true },
      }),
    ]);

    const stepOrder = [
      'page_view',
      'wallet_connected',
      'token_selected',
      'quote_requested',
      'quote_returned',
      'review_swap_clicked',
      'wallet_signature',
      'transaction_submitted',
      'onchain_confirmed',
    ];

    const funnelMap: Record<string, number> = {};
    for (const g of funnelCounts) {
      funnelMap[g.step_name] = g._count._all;
    }
    // 用 events 表补齐（funnel 表可能为空，events 表有 quote_returned 等）
    for (const g of eventCounts) {
      if (stepOrder.includes(g.event_name) && funnelMap[g.event_name] === undefined) {
        funnelMap[g.event_name] = g._count._all;
      }
    }

    const steps = stepOrder.map((name, idx) => ({
      step: idx + 1,
      name,
      count: funnelMap[name] ?? 0,
    }));

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      steps,
      note:
        '漏斗数据来自 analytics_events / analytics_funnel_events（第三步事件采集）。' +
        '当前仅统计已上报的事件；前端埋点覆盖后漏斗才完整。',
    };
  }

  // ---------- 私有 ----------

  private async confirmedUsdVolume(where: Prisma.SwapWhereInput): Promise<string> {
    const confirmed = await this.prisma.swap.findMany({
      where: { ...where, status: SwapStatus.CONFIRMED },
      select: { token_in: true, token_out: true, amount_in: true, amount_out: true },
    });
    const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
    let total = 0n;
    for (const s of confirmed) {
      if (s.token_in.toLowerCase() === USDC) {
        total += BigInt(s.amount_in.toString());
      } else if (s.token_out.toLowerCase() === USDC) {
        total += BigInt(s.amount_out.toString());
      }
    }
    return total.toString();
  }

  private assertChainIdIfPresent(chainId?: number): void {
    if (chainId !== undefined && !isSupportedChainId(chainId)) {
      throw new BadRequestException(`不支持的 chainId: ${chainId}（支持 8453 / 84532）`);
    }
  }
}
