import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 问题诊断（Analytics 第九步）。
 *
 * 基于 intent_id 做「交易级全链路追踪」：把一次交易意图的前端行为 → 报价 →
 * 路由 → 交易 → 链上回执 → 错误事件串联起来，用于定位单笔交易的问题。
 *
 * 链路数据落点（第三步埋点）：
 *   analytics_intents      —— 意图主记录
 *   analytics_funnel_events —— 漏斗步骤
 *   quotes                 —— 报价（intent_id）
 *   route_candidates       —— 路由候选（intent_id, is_selected）
 *   swaps                  —— 交易（intent_id, failure_reason, gas_used）
 *   error_events           —— 错误（intent_id, error_type）
 */

const FUNNEL_ORDER: Record<string, number> = {
  page_view: 1,
  wallet_connected: 2,
  token_selected: 3,
  quote_requested: 4,
  quote_returned: 5,
  review_swap_clicked: 6,
  wallet_signature: 7,
  transaction_submitted: 8,
  onchain_confirmed: 9,
};

@Injectable()
export class DiagnosisService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 交易级全链路追踪 ----------

  async traceIntent(intentId: string) {
    const [intent, funnel, quotes, routes, swaps, errors] = await Promise.all([
      this.prisma.analyticsIntent.findUnique({ where: { intent_id: intentId } }),
      this.prisma.analyticsFunnelEvent.findMany({
        where: { intent_id: intentId },
        orderBy: { step: 'asc' },
      }),
      this.prisma.quote.findMany({
        where: { intent_id: intentId },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          amount_in: true,
          amount_out: true,
          price_impact: true,
          protocol: true,
          response_ms: true,
          created_at: true,
        },
      }),
      this.prisma.routeCandidate.findMany({
        where: { intent_id: intentId },
        orderBy: { is_selected: 'desc' },
        select: {
          id: true,
          protocol_path: true,
          pool_path: true,
          amount_out: true,
          net_output: true,
          price_impact: true,
          is_selected: true,
          route_compute_ms: true,
        },
      }),
      this.prisma.swap.findMany({
        where: { intent_id: intentId },
        select: {
          id: true,
          tx_hash: true,
          status: true,
          amount_in: true,
          amount_out: true,
          failure_reason: true,
          gas_used: true,
          effective_gas_price: true,
          created_at: true,
          confirmed_at: true,
        },
      }),
      this.prisma.errorEvent.findMany({
        where: { intent_id: intentId },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          error_code: true,
          error_type: true,
          message: true,
          service: true,
          created_at: true,
        },
      }),
    ]);

    if (!intent) {
      return { found: false, intentId };
    }

    // 计算漏斗进度（走到哪一步）
    const steps = funnel.map((f) => ({
      step: f.step,
      name: f.step_name,
      status: f.status,
    }));
    const maxStep = steps.length > 0 ? Math.max(...steps.map((s) => s.step)) : 0;
    const funnelProgress = {
      reachedStep: maxStep,
      reachedStepName:
        Object.entries(FUNNEL_ORDER).find(([, v]) => v === maxStep)?.[0] ?? '未开始',
      totalSteps: 9,
    };

    // 诊断结论
    const diagnosis = this.buildDiagnosis(intent, swaps, errors, funnelProgress);

    return {
      found: true,
      intentId,
      intent: {
        walletAddress: intent.wallet_address,
        chainId: intent.chain_id,
        tokenIn: intent.token_in,
        tokenOut: intent.token_out,
        amountIn: intent.amount_in,
        status: intent.status,
        startedAt: intent.started_at,
        completedAt: intent.completed_at,
      },
      funnelProgress,
      steps,
      quotes: quotes.map((q) => ({
        quoteId: q.id,
        amountIn: q.amount_in.toString(),
        amountOut: q.amount_out.toString(),
        priceImpact: q.price_impact.toString(),
        protocol: q.protocol,
        responseMs: q.response_ms,
        createdAt: q.created_at,
      })),
      routes: routes.map((r) => ({
        routeId: r.id,
        protocolPath: r.protocol_path,
        poolPath: r.pool_path,
        amountOut: r.amount_out.toString(),
        netOutput: r.net_output.toString(),
        priceImpact: r.price_impact.toString(),
        isSelected: r.is_selected,
        computeMs: r.route_compute_ms,
      })),
      swaps: swaps.map((s) => ({
        swapId: s.id,
        txHash: s.tx_hash,
        status: s.status,
        amountIn: s.amount_in.toString(),
        amountOut: s.amount_out.toString(),
        failureReason: s.failure_reason,
        gasUsed: s.gas_used,
        effectiveGasPrice: s.effective_gas_price,
        createdAt: s.created_at,
        confirmedAt: s.confirmed_at,
      })),
      errors: errors.map((e) => ({
        errorCode: e.error_code,
        errorType: e.error_type,
        message: e.message,
        service: e.service,
        createdAt: e.created_at,
      })),
      diagnosis,
    };
  }

  // ---------- 意图列表（用于定位问题交易） ----------

  async listIntents(status?: string, limit = 50) {
    const intents = await this.prisma.analyticsIntent.findMany({
      where: status ? { status } : {},
      orderBy: { started_at: 'desc' },
      take: limit,
      select: {
        intent_id: true,
        wallet_address: true,
        chain_id: true,
        token_in: true,
        token_out: true,
        status: true,
        started_at: true,
        completed_at: true,
      },
    });

    const total = status
      ? await this.prisma.analyticsIntent.count({ where: { status } })
      : await this.prisma.analyticsIntent.count();

    return {
      generatedAt: new Date().toISOString(),
      total,
      intents,
    };
  }

  // ---------- 失败交易列表 ----------

  async listFailures(limit = 50) {
    const failed = await this.prisma.swap.findMany({
      where: {
        OR: [
          { status: { in: ['failed', 'reverted'] } },
          { failure_reason: { not: null } },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        intent_id: true,
        tx_hash: true,
        user_address: true,
        token_in: true,
        token_out: true,
        amount_in: true,
        status: true,
        failure_reason: true,
        gas_used: true,
        created_at: true,
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      total: failed.length,
      failures: failed.map((f) => ({
        swapId: f.id,
        intentId: f.intent_id,
        txHash: f.tx_hash,
        userAddress: f.user_address,
        tokenIn: f.token_in,
        tokenOut: f.token_out,
        amountIn: f.amount_in.toString(),
        status: f.status,
        failureReason: f.failure_reason,
        gasUsed: f.gas_used,
        createdAt: f.created_at,
      })),
    };
  }

  // ---------- 私有 ----------

  private buildDiagnosis(
    intent: { status: string },
    swaps: Array<{ status: string; failure_reason: string | null }>,
    errors: Array<{ error_type: string; error_code: string; message: string | null }>,
    funnelProgress: { reachedStep: number; reachedStepName: string },
  ) {
    const reasons: string[] = [];

    // 交易层失败
    const failedSwaps = swaps.filter((s) =>
      ['failed', 'reverted'].includes(s.status),
    );
    if (failedSwaps.length > 0) {
      const reason = failedSwaps.map((s) => s.failure_reason).filter(Boolean)[0];
      reasons.push(
        `交易链上失败（${failedSwaps.length} 笔）${reason ? `：${reason}` : ''}`,
      );
    }

    // 技术错误
    const technicalErrors = errors.filter((e) => e.error_type === 'technical');
    if (technicalErrors.length > 0) {
      reasons.push(
        `存在 ${technicalErrors.length} 个技术错误（${technicalErrors
          .map((e) => e.error_code)
          .join(', ')}）`,
      );
    }

    // 业务错误
    const businessErrors = errors.filter((e) => e.error_type === 'business');
    if (businessErrors.length > 0) {
      reasons.push(
        `存在 ${businessErrors.length} 个业务错误（${businessErrors
          .map((e) => e.error_code)
          .join(', ')}）`,
      );
    }

    // 漏斗中断（未走到确认但意图未完成）
    if (funnelProgress.reachedStep < 9 && intent.status !== 'confirmed') {
      reasons.push(
        `漏斗中断于第 ${funnelProgress.reachedStep} 步「${funnelProgress.reachedStepName}」`,
      );
    }

    // 无交易记录
    if (swaps.length === 0 && intent.status !== 'abandoned') {
      reasons.push('未产生链上交易记录（可能未走到提交或已放弃）');
    }

    if (reasons.length === 0) {
      return {
        level: 'healthy',
        summary: '链路完整，无异常。',
        reasons: [],
      };
    }

    const level = failedSwaps.length > 0 || technicalErrors.length > 0 ? 'error' : 'warning';
    return {
      level,
      summary: reasons.join('；'),
      reasons,
    };
  }
}
