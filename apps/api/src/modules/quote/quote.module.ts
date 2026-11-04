import { Module } from '@nestjs/common';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';
import { DexModule } from '../../dex/dex.module';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * 报价引擎模块（Sprint 4）。
 * 依赖 DexModule（Aerodrome Adapter）、PrismaModule / ChainModule（均 @Global）。
 * 引入 AnalyticsModule 以注入 EventCollectorService（事件采集旁路）。
 */
@Module({
  imports: [DexModule, AnalyticsModule],
  controllers: [QuoteController],
  providers: [QuoteService],
})
export class QuoteModule {}
