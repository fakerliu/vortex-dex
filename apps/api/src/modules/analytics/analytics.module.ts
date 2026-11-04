import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { EventCollectorService } from './event-collector.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DexAnalyticsController } from './dex-analytics.controller';
import { DexAnalyticsService } from './dex-analytics.service';

/**
 * 经营分析模块（Sprint 9 + Analytics 第三~六步）。
 * 依赖 PrismaModule（@Global），无需重复导入。
 * EventCollectorService 导出供 quote/route/swap/indexer 等模块注入。
 */
@Module({
  controllers: [AnalyticsController, DashboardController, DexAnalyticsController],
  providers: [AnalyticsService, EventCollectorService, DashboardService, DexAnalyticsService],
  exports: [AnalyticsService, EventCollectorService],
})
export class AnalyticsModule {}
