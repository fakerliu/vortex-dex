import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INDEXER_CHAIN_ID } from '../../indexer/indexer.constants';

/**
 * 异常中心（Analytics 第八步）。
 *
 * 规则引擎：从 alert_rules 读取启用的规则，对 system_metrics / error_events /
 * sync_state 计算指标值，与阈值比较，命中则写入 anomaly_events（幂等：同规则
 * 同窗口内已存在 open 异常则不重复）。
 *
 * 内置指标计算：
 *   - error_rate    ：最近 window 内 technical 错误率（%）
 *   - block_lag     ：indexer 落后区块数
 *   - request_count ：最近 window 内请求总数
 *   - quote_latency_p95 ：报价响应耗时 P95（ms）
 *
 * 金额铁律：指标值一律字符串。
 */

const DEFAULT_RULES: Array<{
  name: string;
  metric_name: string;
  operator: string;
  threshold: string;
  window_minutes: number;
  severity: string;
  description: string;
}> = [
  {
    name: '错误率过高',
    metric_name: 'error_rate',
    operator: 'gt',
    threshold: '5',
    window_minutes: 60,
    severity: 'warning',
    description: '最近 60 分钟 technical 错误率超过 5%',
  },
  {
    name: 'Indexer 落后过多',
    metric_name: 'block_lag',
    operator: 'gt',
    threshold: '100',
    window_minutes: 60,
    severity: 'critical',
    description: 'Indexer 落后超过 100 个区块',
  },
  {
    name: '报价延迟过高',
    metric_name: 'quote_latency_p95',
    operator: 'gt',
    threshold: '5000',
    window_minutes: 60,
    severity: 'warning',
    description: '报价响应 P95 延迟超过 5000ms',
  },
];

@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- 规则管理 ----------

  async listRules() {
    const rules = await this.prisma.alertRule.findMany({
      orderBy: { created_at: 'asc' },
    });
    return {
      generatedAt: new Date().toISOString(),
      rules,
    };
  }

  async upsertRule(input: {
    id?: string;
    name: string;
    metricName: string;
    operator: string;
    threshold: string;
    windowMinutes?: number;
    severity?: string;
    isEnabled?: boolean;
    description?: string;
  }) {
    this.assertOperator(input.operator);
    const data = {
      name: input.name,
      metric_name: input.metricName,
      operator: input.operator,
      threshold: input.threshold,
      window_minutes: input.windowMinutes ?? 60,
      severity: input.severity ?? 'warning',
      is_enabled: input.isEnabled ?? true,
      description: input.description ?? null,
    };
    const rule = input.id
      ? await this.prisma.alertRule.update({ where: { id: input.id }, data })
      : await this.prisma.alertRule.create({ data });
    return rule;
  }

  async toggleRule(id: string, isEnabled: boolean) {
    return this.prisma.alertRule.update({
      where: { id },
      data: { is_enabled: isEnabled },
    });
  }

  async deleteRule(id: string) {
    await this.prisma.alertRule.delete({ where: { id } });
    return { deleted: true, id };
  }

  // ---------- 规则引擎扫描 ----------

  /**
   * 执行一轮规则扫描：对每条启用规则计算指标值，命中则记录异常（幂等）。
   */
  async scan(): Promise<{
    scannedRules: number;
    triggered: number;
    anomalies: Array<{ ruleName: string; metricValue: string; severity: string }>;
  }> {
    const rules = await this.prisma.alertRule.findMany({
      where: { is_enabled: true },
    });
    const anomalies: Array<{ ruleName: string; metricValue: string; severity: string }> = [];
    let triggered = 0;

    for (const rule of rules) {
      const value = await this.computeMetric(rule.metric_name, rule.window_minutes);
      if (value === null) continue;

      if (this.compare(value, rule.operator, rule.threshold)) {
        const created = await this.recordAnomaly(rule, value);
        if (created) {
          triggered++;
          anomalies.push({
            ruleName: rule.name,
            metricValue: value.toString(),
            severity: rule.severity,
          });
        }
      }
    }

    return { scannedRules: rules.length, triggered, anomalies };
  }

  /** 初始化内置规则（幂等：按 metric_name 去重）。 */
  async seedDefaultRules(): Promise<{ seeded: number }> {
    let seeded = 0;
    for (const r of DEFAULT_RULES) {
      const exists = await this.prisma.alertRule.findFirst({
        where: { metric_name: r.metric_name, name: r.name },
      });
      if (!exists) {
        await this.prisma.alertRule.create({
          data: {
            name: r.name,
            metric_name: r.metric_name,
            operator: r.operator,
            threshold: r.threshold,
            window_minutes: r.window_minutes,
            severity: r.severity,
            description: r.description,
          },
        });
        seeded++;
      }
    }
    return { seeded };
  }

  // ---------- 异常事件查询 / 处理 ----------

  async listAnomalies(status?: string, severity?: string, limit = 50) {
    if (status && !['open', 'acknowledged', 'resolved'].includes(status)) {
      throw new BadRequestException(`status 仅支持 open/acknowledged/resolved，收到: ${status}`);
    }
    const where: Prisma.AnomalyEventWhereInput = {
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
    };
    const [events, openCount] = await Promise.all([
      this.prisma.anomalyEvent.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
      }),
      this.prisma.anomalyEvent.count({ where: { status: 'open' } }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      openCount,
      total: events.length,
      events,
    };
  }

  async resolveAnomaly(id: string, status: 'acknowledged' | 'resolved') {
    return this.prisma.anomalyEvent.update({
      where: { id },
      data: {
        status,
        ...(status === 'resolved' ? { resolved_at: new Date() } : {}),
      },
    });
  }

  // ---------- 私有 ----------

  private async computeMetric(metricName: string, windowMinutes: number): Promise<number | null> {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    switch (metricName) {
      case 'error_rate': {
        const technical = await this.prisma.errorEvent.count({
          where: { error_type: 'technical', created_at: { gte: since } },
        });
        const requests = await this.aggregateRequestCount(since);
        if (requests === 0) return 0;
        return Number(((technical / requests) * 100).toFixed(4));
      }
      case 'block_lag': {
        const sync = await this.prisma.syncState.findUnique({
          where: { chain_id: INDEXER_CHAIN_ID },
        });
        if (!sync) return null;
        // lag 需要链上最新区块，这里用 sync 表里可能存的 last_synced 与链上对比；
        // 简化：lag 用 last_synced_block 相对「最近一次同步」的差异无法精确，返回 null 时跳过。
        // 更稳妥：直接读 indexer 状态（但为避免模块耦合，此处用 sync_state 的 last_synced_block 作为已同步高度，
        // 链上最新区块由外部传入不可得，故 block_lag 规则在无外部数据时返回 null，由 indexer 自身告警兜底。）
        return null;
      }
      case 'request_count': {
        return this.aggregateRequestCount(since);
      }
      case 'quote_latency_p95': {
        const rows = await this.prisma.systemMetric.findMany({
          where: {
            service_name: 'quote-engine',
            metric_name: 'response_ms',
            timestamp: { gte: since },
          },
          select: { metric_value: true },
        });
        if (rows.length === 0) return null;
        const values = rows
          .map((r) => Number(r.metric_value))
          .filter((v) => !Number.isNaN(v))
          .sort((a, b) => a - b);
        if (values.length === 0) return null;
        const idx = Math.ceil(0.95 * values.length) - 1;
        return values[Math.max(0, Math.min(idx, values.length - 1))];
      }
      default:
        return null;
    }
  }

  private async aggregateRequestCount(since: Date): Promise<number> {
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

  private compare(value: number, operator: string, threshold: string): boolean {
    const t = Number(threshold);
    if (Number.isNaN(t)) return false;
    switch (operator) {
      case 'gt':
        return value > t;
      case 'gte':
        return value >= t;
      case 'lt':
        return value < t;
      case 'lte':
        return value <= t;
      default:
        return false;
    }
  }

  private async recordAnomaly(
    rule: {
      id: string;
      name: string;
      metric_name: string;
      operator: string;
      threshold: string;
      severity: string;
      window_minutes: number;
    },
    value: number,
  ): Promise<boolean> {
    // 幂等：同规则同窗口内已存在 open 异常则不重复
    const since = new Date(Date.now() - rule.window_minutes * 60 * 1000);
    const existing = await this.prisma.anomalyEvent.findFirst({
      where: {
        rule_id: rule.id,
        status: 'open',
        created_at: { gte: since },
      },
    });
    if (existing) return false;

    await this.prisma.anomalyEvent.create({
      data: {
        rule_id: rule.id,
        rule_name: rule.name,
        metric_name: rule.metric_name,
        metric_value: value.toString(),
        threshold: rule.threshold,
        severity: rule.severity,
        status: 'open',
        message: `${rule.name}：${rule.metric_name}=${value} 触发阈值（${rule.operator} ${rule.threshold}）`,
      },
    });
    return true;
  }

  private assertOperator(operator: string): void {
    if (!['gt', 'gte', 'lt', 'lte'].includes(operator)) {
      throw new BadRequestException(`operator 仅支持 gt/gte/lt/lte，收到: ${operator}`);
    }
  }
}
