import { Module } from '@nestjs/common';
import { DexModule } from '../../dex/dex.module';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';

/**
 * 交易执行模块（Sprint 6）。
 * 依赖 DexModule（DexPoolService + Aerodrome classic/CL Adapter）。
 * PrismaModule / ChainModule 均为 @Global，无需重复导入。
 */
@Module({
  imports: [DexModule],
  controllers: [SwapController],
  providers: [SwapService],
})
export class SwapModule {}
