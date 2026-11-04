import { Module } from '@nestjs/common';
import { SwapReconcilerController } from './swap-reconciler.controller';
import { SwapReconcilerService } from './swap-reconciler.service';

/**
 * 交易对账 / 回填模块（Sprint 8）。
 * 与 SwapModule（交易执行）分离，便于独立扩展 / 独立后台循环。
 * 依赖 PrismaModule / ChainModule（均为 @Global），无需重复导入。
 */
@Module({
  controllers: [SwapReconcilerController],
  providers: [SwapReconcilerService],
  exports: [SwapReconcilerService],
})
export class SwapReconcilerModule {}
