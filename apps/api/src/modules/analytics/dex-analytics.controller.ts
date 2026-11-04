import { Controller, Get, Query } from '@nestjs/common';
import { DexAnalyticsService } from './dex-analytics.service';

/**
 * DEX 专业分析 API（Analytics 第六步），路由 /api/v1/analytics/dex/*。
 * - GET /dex/routes    ：路由引擎分析（候选数/命中率/耗时/优化收益）
 * - GET /dex/protocols ：协议分析（选中占比/价格影响/净输出）
 * - GET /dex/pools     ：池子分析（路由频次/选中率/流动性）
 */
@Controller('analytics/dex')
export class DexAnalyticsController {
  constructor(private readonly dex: DexAnalyticsService) {}

  @Get('routes')
  routes(@Query('chainId') chainId?: string) {
    return this.dex.getRoutes(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }

  @Get('protocols')
  protocols(@Query('chainId') chainId?: string) {
    return this.dex.getProtocols(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }

  @Get('pools')
  pools(@Query('chainId') chainId?: string) {
    return this.dex.getPools(
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }
}
