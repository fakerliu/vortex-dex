import { Module } from '@nestjs/common';
import { DexModule } from '../../dex/dex.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';

/**
 * 交易执行模块（Sprint 6）。
 * 依赖 DexModule（DexPoolService + Aerodrome classic/CL Adapter）。
 * PrismaModule / ChainModule 均为 @Global，无需重复导入。
 * 引入 AnalyticsModule 以注入 EventCollectorService（事件采集旁路）。
 */
@Module({
  imports: [DexModule, AnalyticsModule],
  controllers: [SwapController],
  providers: [SwapService],
})
export class SwapModule {}
