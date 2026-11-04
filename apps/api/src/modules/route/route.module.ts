import { Module } from '@nestjs/common';
import { DexModule } from '../../dex/dex.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';

/**
 * 路由引擎模块（Sprint 5）。
 * 依赖 DexModule（DexPoolService：池发现 + 逐池报价）。
 * PrismaModule / ChainModule 均为 @Global，无需重复导入。
 * 引入 AnalyticsModule 以注入 EventCollectorService（事件采集旁路）。
 */
@Module({
  imports: [DexModule, AnalyticsModule],
  controllers: [RouteController],
  providers: [RouteService],
})
export class RouteModule {}
