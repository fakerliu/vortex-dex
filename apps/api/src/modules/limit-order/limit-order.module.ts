import { Module } from '@nestjs/common';
import { DexModule } from '../../dex/dex.module';
import { SwapModule } from '../swap/swap.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LimitOrderController } from './limit-order.controller';
import { LimitOrderService } from './limit-order.service';
import { LimitOrderKeeperService } from './limit-order-keeper.service';
import {
  LIMIT_ORDER_EXECUTOR,
  PreSignedTxExecutor,
} from './limit-order-executor';

/**
 * 限价单模块（V1.4 Phase 1 链下 keeper）。
 *
 * 单向依赖（无环，架构 §2.4）：
 * - SwapModule（SwapService.prepare / tryReadReceipt）
 * - DexModule（DexPoolService.quoteBestForChain）
 * - NotificationsModule（NotificationDispatcher）
 * PrismaModule / ChainModule 均为 @Global，无需重复导入。
 *
 * PreSignedTxExecutor 以抽象 token 绑定到 LimitOrderExecutor，
 * Phase 2 换 OnChainSettlementExecutor 时只需改 provider 绑定。
 */
@Module({
  imports: [SwapModule, DexModule, NotificationsModule],
  controllers: [LimitOrderController],
  providers: [
    LimitOrderService,
    LimitOrderKeeperService,
    PreSignedTxExecutor,
    { provide: LIMIT_ORDER_EXECUTOR, useExisting: PreSignedTxExecutor },
  ],
  exports: [LimitOrderService, LimitOrderKeeperService, PreSignedTxExecutor],
})
export class LimitOrderModule {}
