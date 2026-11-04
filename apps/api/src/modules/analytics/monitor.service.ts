import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSupportedChainId } from '../../chain/chain.constants';
import { INDEXER_CHAIN_ID } from '../../indexer/indexer.constants';

/**
 * 系统监控（Analytics 第七步）。
 *
 * 聚合 system_metrics / error_events / sync_state，提供：
 *   1. 实时健康检查 —— 数据库、Indexer 落后、错误率
 *   2. 服务指标聚合 —— api / rpc / quote-engine / route-engine / indexer 各服务
 *   3. 错误事件统计 —— technical vs business，按错误码聚合
 *
 * 金额铁律：指标值一律字符串。
 */

const MONITOR_WINDOW_MS = 24 * 3600 * 1000; // 最近 24h

@Injectable()
export class MonitorService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 1. 健康检查 ----------

  async getHealth() {
    const [dbStatus, syncState, errorCount24h, metricCount24h] = await Promise.all([
      this.prisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`.catch(() => []),
      this.prisma.syncState.findUnique({ where: { chain_id: INDEXER_CHAIN_ID } }),
      this.prisma.errorEvent.count({
        where: { created_at: { gte: new Date(Date.now() - MONITOR_WINDOW_MS) } },
      }),
      this.prisma.systemMetric.count({
        where: { timestamp: { gte: new Date(Date.now() - MONITOR_WINDOW_MS) } },
      }),
    ]);

    const dbUp = dbStatus.length > 0;
    const lastSyncedBlock = syncState?.last_synced_block ?? 0;

    // 错误率：最近 24h technical 错误 / 总请求数（用 system_metrics 里的 request_count 估算）
    const technicalErrors24h = await this.prisma.errorEvent.count({
      where: {
        error_type: 'technical',
        created_at: { gte: new Date(Date.now() - MONITOR_WINDOW_MS) },
      },
    });
    const requestCount24h = await this.aggregateRequestCount();

    return {
      generatedAt: new Date().toISOString(),
      database: dbUp ? 'up' : 'down',
      indexer: {
        chainId: INDEXER_CHAIN_ID,
        lastSyncedBlock,
        running: Boolean(syncState),
      },
      errors24h: {
        total: errorCount24h,
        technical: technicalErrors24h,
        business: errorCount24h - technicalErrors24h,
      },
      errorRate24h:
        requestCount24h > 0
          ? ((technicalErrors24h / requestCount24h) * 100).toFixed(2)
          : '0',
      metrics24h: metricCount24h,
      note:
        'errorRate24h = technical 错误数 / 请求总数（request_count 指标求和）×100%。' +
        'database 通过 SELECT now() 探测；indexer.running 依据 sync_state 是否存在。',
    };
  }

  // ---------- 2. 服务指标聚合 ----------

  async getServices() {
    const since = new Date(Date.now() - MONITOR_WINDOW_MS);
    const rows = await this.prisma.systemMetric.findMany({
      where: { timestamp: { gte: since } },
      select: {
        service_name: true,
        metric_name: true,
        metric_value: true,
        metric_unit: true,
      },
    });

    const services = new Map<
      string,
      Map<string, { sum: number; count: number; max: number; unit: string | null }>
    >();

    for (const r of rows) {
      const v = Number(r.metric_value);
      if (Number.isNaN(v)) continue;
      const svc = services.get(r.service_name) ?? new Map();
      const m = svc.get(r.metric_name) ?? { sum: 0, count: 0, max: 0, unit: r.metric_unit };
      m.sum += v;
      m.count++;
      m.max = Math.max(m.max, v);
      svc.set(r.metric_name, m);
      services.set(r.service_name, svc);
    }

    const result = Array.from(services.entries()).map(([service, metrics]) => ({
      service,
      metrics: Array.from(metrics.entries()).map(([name, m]) => ({
        name,
        unit: m.unit,
        avg: (m.sum / m.count).toFixed(2),
        max: String(m.max),
        samples: m.count,
      })),
    }));

    return {
      generatedAt: new Date().toISOString(),
      window: '24h',
      services: result,
      note: '来自 system_metrics（最近 24h）；avg/max 按 metric_name 聚合。',
    };
  }

  // ---------- 3. 错误事件统计 ----------

  async getErrors(chainId?: number, type?: string) {
    if (type !== undefined && type !== 'business' && type !== 'technical') {
      throw new BadRequestException(`type 仅支持 business / technical，收到: ${type}`);
    }
    const since = new Date(Date.now() - MONITOR_WINDOW_MS);
    const where: Prisma.ErrorEventWhereInput = {
      created_at: { gte: since },
      ...(type ? { error_type: type } : {}),
      ...(chainId !== undefined ? { chain_id: chainId } : {}),
    };

    const [byCode, total] = await Promise.all([
      this.prisma.errorEvent.groupBy({
        by: ['error_code', 'error_type'],
        where,
        _count: { _all: true },
      }),
      this.prisma.errorEvent.count({ where }),
    ]);

    const topErrors = byCode
      .sort((a, b) => b._count._all - a._count._all)
      .map((r) => ({
        errorCode: r.error_code,
        type: r.error_type,
        count: r._count._all,
      }));

    return {
      generatedAt: new Date().toISOString(),
      window: '24h',
      chainId: chainId ?? null,
      total,
      topErrors,
      note: '来自 error_events（最近 24h）；type 区分 business / technical。',
    };
  }

  // ---------- 私有 ----------

  private async aggregateRequestCount(): Promise<number> {
    const since = new Date(Date.now() - MONITOR_WINDOW_MS);
    const rows = await this.prisma.systemMetric.findMany({
      where: {
        timestamp: { gte: since },
        metric_name: { in: ['request_count', 'candidate_count'] },
      },
      select: { metric_value: true },
    });
    let total = 0;
    for (const r of rows) {
      const v = Number(r.metric_value);
      if (!Number.isNaN(v)) total += v;
    }
    return total;
  }
}
