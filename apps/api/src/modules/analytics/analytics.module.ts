import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { EventCollectorService } from './event-collector.service';

/**
 * 经营分析模块（Sprint 9 + Analytics 第三步事件采集）。
 * 依赖 PrismaModule（@Global），无需重复导入。
 * EventCollectorService 导出供 quote/route/swap/indexer 等模块注入。
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, EventCollectorService],
  exports: [AnalyticsService, EventCollectorService],
})
export class AnalyticsModule {}
