import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

/**
 * 核心 Dashboard API（Analytics 第五步），路由 /api/v1/analytics/dashboard/*。
 * - GET /dashboard/overview ：经营总览
 * - GET /dashboard/trading  ：交易分析
 * - GET /dashboard/users    ：用户分析
 * - GET /dashboard/funnel   ：转化漏斗
 */
@Controller('analytics/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview(@Query('chainId') chainId?: string) {
    return this.dashboard.getOverview(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }

  @Get('trading')
  trading(
    @Query('chainId') chainId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.getTrading(
      chainId !== undefined ? Number(chainId) : undefined,
      from,
      to,
    );
  }

  @Get('users')
  users(@Query('chainId') chainId?: string) {
    return this.dashboard.getUsers(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }

  @Get('funnel')
  funnel(@Query('chainId') chainId?: string) {
    return this.dashboard.getFunnel(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }
}
