import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSupportedChainId } from '../../chain/chain.constants';

/**
 * DEX 专业分析（Analytics 第六步）。
 *
 * 基于 route_candidates 的 is_selected / route_compute_ms / net_output /
 * price_impact / route_score / protocol_path / pool_path 等新字段，做三块深度分析：
 *   1. 路由引擎（Route）—— 候选数、命中率、计算耗时、路由优化收益
 *   2. 协议（Protocol） —— 各协议被选中占比、平均价格影响/净输出
 *   3. 池子（Pool）     —— 各池子被路由频次、流动性 vs 被选中
 *
 * 金额铁律：链上原始大整数一律字符串，禁 Float。
 * protocol_path / pool_path 在库中为 JSON 字符串数组，需解析展开。
 */

const TOP_N = 20;

@Injectable()
export class DexAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 1. 路由引擎分析 ----------

  async getRoutes(chainId?: number) {
    this.assertChainIdIfPresent(chainId);
    const where: Prisma.RouteCandidateWhereInput =
      chainId !== undefined ? { } : {};

    // route_candidates 无 chain_id 列，用 token_path 无法过滤 chain；这里按全量统计。
    // 若需按链过滤，改由关联 quote（quote_id -> Quote.chain_id）下钻。
    const [all, selected, byPath] = await Promise.all([
      this.prisma.routeCandidate.findMany({
        select: {
          path_id: true,
          route_compute_ms: true,
          net_output: true,
          amount_out: true,
          price_impact: true,
          route_score: true,
          is_selected: true,
        },
      }),
      this.prisma.routeCandidate.count({ where: { is_selected: true } }),
      this.prisma.routeCandidate.findMany({
        where: { is_selected: true },
        select: {
          path_id: true,
          net_output: true,
          amount_out: true,
        },
      }),
    ]);

    const total = all.length;
    const selectedCount = selected;

    // 每次路径计算（path_id）的候选数分布
    const pathMap = new Map<string, number>();
    for (const r of all) {
      pathMap.set(r.path_id, (pathMap.get(r.path_id) ?? 0) + 1);
    }
    const candidateCounts = Array.from(pathMap.values());
    const avgCandidates =
      candidateCounts.length > 0
        ? (candidateCounts.reduce((a, b) => a + b, 0) / candidateCounts.length).toFixed(2)
        : '0';
    const maxCandidates = candidateCounts.length > 0 ? Math.max(...candidateCounts) : 0;
    const minCandidates = candidateCounts.length > 0 ? Math.min(...candidateCounts) : 0;

    // 计算耗时分布
    const computeMs = all
      .map((r) => r.route_compute_ms)
      .filter((v): v is number => v !== null && v !== undefined);
    const avgComputeMs =
      computeMs.length > 0
        ? Math.round(computeMs.reduce((a, b) => a + b, 0) / computeMs.length)
        : 0;
    const maxComputeMs = computeMs.length > 0 ? Math.max(...computeMs) : 0;
    const p95ComputeMs = this.percentile(computeMs, 95);

    // 路由优化收益：对每个 path_id，取 is_selected 的 net_output 与其余候选最大 net_output 对比
    const selectedNet = new Map<string, bigint>();
    const bestAltNet = new Map<string, bigint>();
    for (const r of byPath) {
      selectedNet.set(r.path_id, BigInt(r.net_output.toString()));
    }
    // 对每个 path，找非选中候选里的最大 net_output
    const altMap = new Map<string, bigint>();
    for (const r of all) {
      if (r.is_selected) continue;
      const cur = altMap.get(r.path_id) ?? 0n;
      const v = BigInt(r.net_output.toString());
      if (v > cur) altMap.set(r.path_id, v);
    }
    let totalGain = 0n;
    let gainPaths = 0;
    for (const [pathId, sel] of selectedNet) {
      const alt = altMap.get(pathId) ?? 0n;
      if (sel >= alt && alt > 0n) {
        totalGain += sel - alt;
        gainPaths++;
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      totalRouteComputations: pathMap.size,
      totalCandidates: total,
      selectedCandidates: selectedCount,
      selectionHitRate:
        pathMap.size > 0 ? ((selectedCount / pathMap.size) * 100).toFixed(2) : '0',
      avgCandidates,
      minCandidates,
      maxCandidates,
      avgComputeMs,
      maxComputeMs,
      p95ComputeMs,
      routeOptimizationGain: totalGain.toString(),
      routeOptimizationGainPaths: gainPaths,
      note:
        '路由优化收益 = Σ(选中路由 net_output - 同次计算中次优候选最大 net_output)，仅统计选中更优的路径；' +
        'net_output 为原始大整数（wei 级）。',
    };
  }

  // ---------- 2. 协议分析 ----------

  async getProtocols(chainId?: number) {
    this.assertChainIdIfPresent(chainId);
    const rows = await this.prisma.routeCandidate.findMany({
      select: {
        protocol_path: true,
        is_selected: true,
        price_impact: true,
        route_score: true,
        net_output: true,
      },
    });

    // 展开 protocol_path JSON 数组，聚合每个协议的统计
    const agg = new Map<
      string,
      { total: number; selected: number; priceImpacts: bigint[]; netOutputs: bigint[] }
    >();
    for (const r of rows) {
      let protos: string[] = [];
      try {
        protos = JSON.parse(r.protocol_path) as string[];
      } catch {
        protos = [r.protocol_path];
      }
      for (const p of protos) {
        if (!p) continue;
        const cur = agg.get(p) ?? { total: 0, selected: 0, priceImpacts: [], netOutputs: [] };
        cur.total++;
        if (r.is_selected) cur.selected++;
        cur.priceImpacts.push(BigInt(Math.round(Number(r.price_impact.toString()) * 1e18)));
        cur.netOutputs.push(BigInt(r.net_output.toString()));
        agg.set(p, cur);
      }
    }

    const protocols = Array.from(agg.entries())
      .map(([protocol, v]) => {
        const avgPriceImpact =
          v.priceImpacts.length > 0
            ? (
                v.priceImpacts.reduce((a, b) => a + b, 0n) /
                BigInt(v.priceImpacts.length)
              ).toString()
            : '0';
        const avgNetOutput =
          v.netOutputs.length > 0
            ? (v.netOutputs.reduce((a, b) => a + b, 0n) / BigInt(v.netOutputs.length)).toString()
            : '0';
        return {
          protocol,
          totalCandidates: v.total,
          selectedCount: v.selected,
          selectionRate:
            v.total > 0 ? ((v.selected / v.total) * 100).toFixed(2) : '0',
          avgPriceImpact: avgPriceImpact, // ×1e18 缩放
          avgNetOutput,
        };
      })
      .sort((a, b) => b.selectedCount - a.selectedCount)
      .slice(0, TOP_N);

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      protocols,
      note:
        'avgPriceImpact 为 ×1e18 缩放（如 0.1% = 1e15）；avgNetOutput 为原始大整数。' +
        'selectionRate = 该协议被选中次数 / 该协议作为候选出现次数。',
    };
  }

  // ---------- 3. 池子分析 ----------

  async getPools(chainId?: number) {
    this.assertChainIdIfPresent(chainId);
    const rows = await this.prisma.routeCandidate.findMany({
      select: {
        pool_path: true,
        is_selected: true,
      },
    });

    const agg = new Map<string, { total: number; selected: number }>();
    for (const r of rows) {
      let pools: string[] = [];
      try {
        pools = JSON.parse(r.pool_path) as string[];
      } catch {
        pools = [r.pool_path];
      }
      for (const p of pools) {
        if (!p) continue;
        const cur = agg.get(p) ?? { total: 0, selected: 0 };
        cur.total++;
        if (r.is_selected) cur.selected++;
        agg.set(p, cur);
      }
    }

    // 关联池子流动性（pools 表）
    const poolAddresses = Array.from(agg.keys()).map((a) => a.toLowerCase());
    const poolLiquidity = new Map<string, string>();
    if (poolAddresses.length > 0) {
      const pools = await this.prisma.pool.findMany({
        where: {
          pool_address: { in: poolAddresses },
          ...(chainId !== undefined ? { chain_id: chainId } : {}),
        },
        select: { pool_address: true, liquidity: true },
      });
      for (const p of pools) {
        poolLiquidity.set(p.pool_address.toLowerCase(), p.liquidity.toString());
      }
    }

    const topPools = Array.from(agg.entries())
      .map(([pool, v]) => ({
        pool: pool.toLowerCase(),
        routedCount: v.total,
        selectedCount: v.selected,
        selectionRate: v.total > 0 ? ((v.selected / v.total) * 100).toFixed(2) : '0',
        liquidity: poolLiquidity.get(pool.toLowerCase()) ?? null,
      }))
      .sort((a, b) => b.routedCount - a.routedCount)
      .slice(0, TOP_N);

    return {
      generatedAt: new Date().toISOString(),
      chainId: chainId ?? null,
      topPools,
      note:
        'routedCount = 池子作为路由候选出现的次数；liquidity 来自 pools 表（原始大整数，null 表示池子未同步到库）。',
    };
  }

  // ---------- 私有 ----------

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const s = [...sortedValues].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * s.length) - 1;
    return s[Math.max(0, Math.min(idx, s.length - 1))];
  }

  private assertChainIdIfPresent(chainId?: number): void {
    if (chainId !== undefined && !isSupportedChainId(chainId)) {
      throw new BadRequestException(`不支持的 chainId: ${chainId}（支持 8453 / 84532）`);
    }
  }
}
