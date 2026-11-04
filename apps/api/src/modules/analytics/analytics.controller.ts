import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { EventCollectorService } from './event-collector.service';
import type {
  AggregateDailyResultDto,
  AnalyticsSummaryDto,
  DailyResultDto,
  ProtocolDistributionResultDto,
} from './analytics.types';

/**
 * 经营分析 API（挂 /api/v1 前缀，路由为 /api/v1/analytics）。
 * - GET /api/v1/analytics/summary               ：经营总览（量/收入分开，来源可追踪）
 * - GET /api/v1/analytics/daily                 ：日度统计（预聚合优先，实时回退）
 * - GET /api/v1/analytics/protocol-distribution ：各协议交易量分布
 * - POST /api/v1/analytics/aggregate            ：触发日聚合落库 analytics_daily（幂等）
 * - POST /api/v1/analytics/events               ：前端埋点事件上报（Analytics 第三步）
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly events: EventCollectorService,
  ) {}

  @Get('summary')
  summary(@Query('chainId') chainId?: string): Promise<AnalyticsSummaryDto> {
    return this.analytics.getSummary(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }

  @Get('daily')
  daily(
    @Query('chainId') chainId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<DailyResultDto> {
    return this.analytics.getDaily(
      chainId !== undefined ? Number(chainId) : undefined,
      from,
      to,
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  @Get('protocol-distribution')
  protocolDistribution(
    @Query('chainId') chainId?: string,
  ): Promise<ProtocolDistributionResultDto> {
    return this.analytics.getProtocolDistribution(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }

  @Post('aggregate')
  aggregate(
    @Query('chainId') chainId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AggregateDailyResultDto> {
    return this.analytics.aggregateDaily(
      chainId !== undefined ? Number(chainId) : undefined,
      from,
      to,
    );
  }

  /** 触发小时聚合落库（幂等，第四步）。 */
  @Post('aggregate-hourly')
  aggregateHourly(
    @Query('chainId') chainId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.aggregateHourly(
      chainId !== undefined ? Number(chainId) : undefined,
      from,
      to,
    );
  }

  /** 小时级统计查询（第四步）。 */
  @Get('hourly')
  hourly(
    @Query('chainId') chainId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.getHourly(
      chainId !== undefined ? Number(chainId) : undefined,
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  /** 前端埋点事件上报（Analytics 第三步）。 */
  @Post('events')
  async recordEvent(
    @Body()
    body: {
      eventName?: string;
      intentId?: string;
      walletAddress?: string;
      chainId?: number;
      sessionId?: string;
      properties?: Record<string, unknown>;
    },
  ): Promise<{ success: boolean }> {
    if (!body.eventName) {
      return { success: false };
    }
    await this.events.track({
      eventName: body.eventName,
      intentId: body.intentId,
      walletAddress: body.walletAddress,
      chainId: body.chainId,
      sessionId: body.sessionId,
      properties: body.properties,
    });
    return { success: true };
  }
}
