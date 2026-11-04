import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 事件采集服务（Analytics 第三步）。
 *
 * 统一采集入口，供 quote / route / swap / indexer 等模块调用，
 * 把「前端行为 → 报价 → 路由 → 交易 → 链上」串联到 intent_id。
 *
 * 铁律：
 * - 采集失败只记录日志，绝不影响主流程（事件采集是旁路，不阻断交易）。
 * - 金额一律字符串；时间一律 UTC。
 * - 不采集私钥 / 助记词 / 签名原文。
 */

/** 事件负载。 */
export interface TrackEventInput {
  eventName: string;
  chainId?: number;
  walletAddress?: string;
  sessionId?: string;
  intentId?: string;
  requestId?: string;
  environment?: string;
  properties?: Record<string, unknown>;
}

/** 漏斗步骤（需求文档 5.1 的 9 步，序号 1..9）。 */
export const FUNNEL_STEPS: Record<string, number> = {
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
export class EventCollectorService {
  private readonly logger = new Logger(EventCollectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 记录一条统一业务事件（旁路，失败不抛出）。 */
  async track(input: TrackEventInput): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          event_id: randomUUID(),
          event_name: input.eventName,
          event_time: new Date(),
          environment: input.environment ?? this.defaultEnv(),
          chain_id: input.chainId ?? null,
          wallet_address: input.walletAddress?.toLowerCase() ?? null,
          session_id: input.sessionId ?? null,
          intent_id: input.intentId ?? null,
          request_id: input.requestId ?? null,
          properties: JSON.stringify(input.properties ?? {}),
        },
      });
    } catch (err) {
      this.logger.warn(`事件采集失败（${input.eventName}）: ${this.errMsg(err)}`);
    }
  }

  /** 记录 / 更新交易意图（幂等：intent_id 唯一）。 */
  async recordIntent(input: {
    intentId: string;
    walletAddress?: string;
    chainId?: number;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    quoteId?: string;
    routeId?: string;
    status: string;
    completed?: boolean;
  }): Promise<void> {
    try {
      await this.prisma.analyticsIntent.upsert({
        where: { intent_id: input.intentId },
        update: {
          ...(input.walletAddress ? { wallet_address: input.walletAddress.toLowerCase() } : {}),
          ...(input.chainId !== undefined ? { chain_id: input.chainId } : {}),
          ...(input.tokenIn ? { token_in: input.tokenIn.toLowerCase() } : {}),
          ...(input.tokenOut ? { token_out: input.tokenOut.toLowerCase() } : {}),
          ...(input.amountIn ? { amount_in: input.amountIn } : {}),
          ...(input.quoteId ? { quote_id: input.quoteId } : {}),
          ...(input.routeId ? { route_id: input.routeId } : {}),
          status: input.status,
          ...(input.completed ? { completed_at: new Date() } : {}),
        },
        create: {
          intent_id: input.intentId,
          wallet_address: input.walletAddress?.toLowerCase() ?? null,
          chain_id: input.chainId ?? null,
          token_in: input.tokenIn?.toLowerCase() ?? null,
          token_out: input.tokenOut?.toLowerCase() ?? null,
          amount_in: input.amountIn ?? null,
          quote_id: input.quoteId ?? null,
          route_id: input.routeId ?? null,
          status: input.status,
          completed_at: input.completed ? new Date() : null,
        },
      });
    } catch (err) {
      this.logger.warn(`意图记录失败（${input.intentId}）: ${this.errMsg(err)}`);
    }
  }

  /** 记录漏斗步骤。 */
  async recordFunnelStep(input: {
    intentId: string;
    stepName: string;
    status?: string;
    properties?: Record<string, unknown>;
  }): Promise<void> {
    const step = FUNNEL_STEPS[input.stepName];
    if (step === undefined) {
      this.logger.warn(`未知漏斗步骤: ${input.stepName}`);
      return;
    }
    try {
      await this.prisma.analyticsFunnelEvent.create({
        data: {
          intent_id: input.intentId,
          step,
          step_name: input.stepName,
          status: input.status ?? 'completed',
          properties: JSON.stringify(input.properties ?? {}),
        },
      });
    } catch (err) {
      this.logger.warn(`漏斗记录失败（${input.stepName}）: ${this.errMsg(err)}`);
    }
  }

  /** 记录系统指标。 */
  async recordMetric(input: {
    serviceName: string;
    metricName: string;
    metricValue: string;
    metricUnit?: string;
    environment?: string;
    dimensions?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.systemMetric.create({
        data: {
          service_name: input.serviceName,
          metric_name: input.metricName,
          metric_value: input.metricValue,
          metric_unit: input.metricUnit ?? null,
          environment: input.environment ?? this.defaultEnv(),
          dimensions: JSON.stringify(input.dimensions ?? {}),
          timestamp: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(`指标记录失败（${input.metricName}）: ${this.errMsg(err)}`);
    }
  }

  /** 记录错误事件（业务 / 技术）。 */
  async recordError(input: {
    errorCode: string;
    errorType: 'business' | 'technical';
    message?: string;
    service?: string;
    intentId?: string;
    requestId?: string;
    chainId?: number;
    context?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.errorEvent.create({
        data: {
          error_code: input.errorCode,
          error_type: input.errorType,
          message: input.message ?? null,
          service: input.service ?? null,
          intent_id: input.intentId ?? null,
          request_id: input.requestId ?? null,
          chain_id: input.chainId ?? null,
          context: JSON.stringify(input.context ?? {}),
        },
      });
    } catch (err) {
      this.logger.warn(`错误记录失败（${input.errorCode}）: ${this.errMsg(err)}`);
    }
  }

  private defaultEnv(): string {
    return process.env.APP_ENV ?? 'production';
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
