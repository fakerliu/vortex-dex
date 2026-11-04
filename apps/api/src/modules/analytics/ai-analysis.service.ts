import { Injectable } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { MonitorService } from './monitor.service';
import { AnomalyService } from './anomaly.service';
import { DexAnalyticsService } from './dex-analytics.service';
import { DiagnosisService } from './diagnosis.service';

/**
 * AI 分析（Analytics 第十步）。
 *
 * 基于规则的「自然语言生成器」：把经营总览 / 系统监控 / 异常中心 / DEX 分析 /
 * 交易诊断的聚合数据，转成可读的中文分析报告。
 *
 * 说明：本步为「智能摘要 + 智能诊断」的规则化实现（无需外部 LLM 密钥即可运行）。
 * 后续若要接入真实 LLM，可在本服务层替换/叠加自然语言生成逻辑，接口契约不变。
 */

@Injectable()
export class AiAnalysisService {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly monitor: MonitorService,
    private readonly anomaly: AnomalyService,
    private readonly dex: DexAnalyticsService,
    private readonly diagnosis: DiagnosisService,
  ) {}

  // ---------- 全局智能摘要 ----------

  async getSummary() {
    const [overview, health, services, anomalies, routes] = await Promise.all([
      this.dashboard.getOverview(),
      this.monitor.getHealth(),
      this.monitor.getServices(),
      this.anomaly.listAnomalies('open', undefined, 10),
      this.dex.getRoutes(),
    ]);

    // 组装自然语言报告
    const paragraphs: string[] = [];

    // 1. 经营概况
    paragraphs.push(
      `截至 ${this.time()}，经营概况：累计 ${overview.totalSwaps} 笔交易，其中 ${overview.confirmedSwaps} 笔已确认，` +
        `${overview.failedSwaps} 笔失败，链上成功率 ${overview.successRate}%。` +
        `去重用户 ${overview.uniqueUsers} 人，最近 24 小时活跃钱包 ${overview.activeWallets24h} 个。` +
        `确认交易的 USDC 计价总成交量约 $${this.formatUsd(overview.volumeUsd)}。`,
    );

    // 2. 系统健康
    const dbOk = health.database === 'up';
    paragraphs.push(
      `系统健康：数据库${dbOk ? '正常' : '异常'}，` +
        `Indexer ${health.indexer.running ? '运行中' : '已停止'}（已同步至区块 ${health.indexer.lastSyncedBlock.toLocaleString()}）。` +
        `最近 24 小时错误 ${health.errors24h.total} 个（技术 ${health.errors24h.technical}、业务 ${health.errors24h.business}），` +
        `错误率 ${health.errorRate24h}%。`,
    );

    // 3. 异常告警
    if (anomalies.openCount > 0) {
      const top = anomalies.events.slice(0, 3).map((e) => e.rule_name);
      paragraphs.push(
        `⚠ 当前有 ${anomalies.openCount} 个未处理异常，涉及：${top.join('、')}。建议优先处理。`,
      );
    } else {
      paragraphs.push('✅ 当前无未处理异常，系统运行平稳。');
    }

    // 4. 路由引擎
    paragraphs.push(
      `路由引擎：累计 ${routes.totalRouteComputations} 次路径计算、${routes.totalCandidates} 个候选路由，` +
        `平均每次 ${routes.avgCandidates} 个候选，最佳路由命中率 ${routes.selectionHitRate}%，` +
        `平均计算耗时 ${routes.avgComputeMs}ms（P95 ${routes.p95ComputeMs}ms）。`,
    );

    return {
      generatedAt: new Date().toISOString(),
      report: paragraphs,
      metrics: {
        totalSwaps: overview.totalSwaps,
        confirmedSwaps: overview.confirmedSwaps,
        successRate: overview.successRate,
        uniqueUsers: overview.uniqueUsers,
        openAnomalies: anomalies.openCount,
        errorRate24h: health.errorRate24h,
        selectionHitRate: routes.selectionHitRate,
      },
    };
  }

  // ---------- 单笔交易智能诊断 ----------

  async diagnoseIntent(intentId: string) {
    const trace = await this.diagnosis.traceIntent(intentId);
    if (!trace.found) {
      return {
        found: false,
        intentId,
        report: '未找到该交易意图，无法诊断。',
      };
    }

    const parts: string[] = [];
    const intent = trace.intent!;

    // 基本链路描述
    parts.push(
      `该意图由钱包 ${this.short(intent.walletAddress ?? '')} 发起，` +
        `交易对 ${this.short(intent.tokenIn ?? '')} → ${this.short(intent.tokenOut ?? '')}，` +
        `当前状态「${intent.status}」。`,
    );

    // 漏斗进度
    if (trace.funnelProgress) {
      const fp = trace.funnelProgress;
      parts.push(
        `漏斗推进到第 ${fp.reachedStep}/${fp.totalSteps} 步「${fp.reachedStepName}」` +
          (fp.reachedStep < 9 ? '，未走完完整链路。' : '，链路完整。'),
      );
    }

    // 报价与路由
    if (trace.quotes && trace.quotes.length > 0) {
      parts.push(`产生 ${trace.quotes.length} 次报价。`);
    }
    if (trace.routes && trace.routes.length > 0) {
      const selected = trace.routes.filter((r) => r.isSelected);
      parts.push(`路由引擎产出 ${trace.routes.length} 个候选，选中 ${selected.length} 个。`);
    }

    // 交易结果
    if (trace.swaps && trace.swaps.length > 0) {
      const s = trace.swaps[0];
      parts.push(
        `链上交易 ${this.short(s.txHash)} 状态「${s.status}」` +
          (s.failureReason ? `，失败原因：${s.failureReason}` : '') +
          (s.gasUsed ? `，gasUsed=${s.gasUsed}` : ''),
      );
    }

    // 错误
    if (trace.errors && trace.errors.length > 0) {
      const errDesc = trace.errors
        .map((e) => `[${e.errorType}]${e.errorCode}`)
        .join('、');
      parts.push(`伴随 ${trace.errors.length} 个错误：${errDesc}。`);
    }

    // 诊断结论
    const conclusion = trace.diagnosis;
    parts.push(`诊断结论：${conclusion?.summary ?? '链路正常'}`);

    return {
      found: true,
      intentId,
      report: parts,
      diagnosis: conclusion,
    };
  }

  // ---------- 私有 ----------

  private time(): string {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }

  private formatUsd(raw: string): string {
    try {
      const n = BigInt(raw);
      const whole = n / 1_000_000n;
      const frac = (n % 1_000_000n).toString().padStart(6, '0');
      return `${whole.toLocaleString()}.${frac.slice(0, 2)}`;
    } catch {
      return '0';
    }
  }

  private short(a: string): string {
    return a && a.length >= 10 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
  }
}
