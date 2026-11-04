import { Controller, Get, Post, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
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
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

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
}
