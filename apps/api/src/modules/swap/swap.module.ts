import { Module } from '@nestjs/common';
import { DexModule } from '../../dex/dex.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MarketModule } from '../market/market.module';
import { SplitController } from './split.controller';
import { SplitService } from './split.service';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';

/**
 * 交易执行模块（Sprint 6）。
 * 依赖 DexModule（DexPoolService + Aerodrome classic/CL Adapter）。
 * PrismaModule / ChainModule 均为 @Global，无需重复导入。
 * 引入 AnalyticsModule 以注入 EventCollectorService（事件采集旁路）。
 * 引入 MarketModule 以注入 MarketService（拆单 USD 阈值换算）。
 * SplitService 复用 SwapService.prepare + DexPoolService 全量候选报价。
 */
@Module({
  imports: [DexModule, AnalyticsModule, MarketModule],
  controllers: [SwapController, SplitController],
  providers: [SwapService, SplitService],
})
export class SwapModule {}
