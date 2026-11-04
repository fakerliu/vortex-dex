import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { EventCollectorService } from './event-collector.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DexAnalyticsController } from './dex-analytics.controller';
import { DexAnalyticsService } from './dex-analytics.service';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { AnomalyController } from './anomaly.controller';
import { AnomalyService } from './anomaly.service';

/**
 * 经营分析模块（Sprint 9 + Analytics 第三~八步）。
 * 依赖 PrismaModule（@Global），无需重复导入。
 * EventCollectorService 导出供 quote/route/swap/indexer 等模块注入。
 */
@Module({
  controllers: [
    AnalyticsController,
    DashboardController,
    DexAnalyticsController,
    MonitorController,
    AnomalyController,
  ],
  providers: [
    AnalyticsService,
    EventCollectorService,
    DashboardService,
    DexAnalyticsService,
    MonitorService,
    AnomalyService,
  ],
  exports: [AnalyticsService, EventCollectorService],
})
export class AnalyticsModule {}
