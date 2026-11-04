import { Module } from '@nestjs/common';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';
import { DexModule } from '../../dex/dex.module';

/**
 * 报价引擎模块（Sprint 4）。
 * 依赖 DexModule（Aerodrome Adapter）、PrismaModule / ChainModule（均 @Global）。
 */
@Module({
  imports: [DexModule],
  controllers: [QuoteController],
  providers: [QuoteService],
})
export class QuoteModule {}
