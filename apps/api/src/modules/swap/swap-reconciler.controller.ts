import { Controller, Param, Post, Query } from '@nestjs/common';
import { SwapReconcilerService } from './swap-reconciler.service';
import type {
  BackfillResult,
  ReconcileBatchResult,
  ReconcileResult,
} from './swap-reconciler.service';

/**
 * 交易对账 / 回填 API（挂 /api/v1 前缀，路由为 /api/v1/swaps）。
 * - POST /api/v1/swaps/reconcile        ：批量核验所有 PENDING 交易（可选 chainId/limit）
 * - POST /api/v1/swaps/backfill         ：消费 Indexer 事件，回填 swap_events.swap_id + 生成/更新 swaps
 * - POST /api/v1/swaps/:id/reconcile    ：核验单笔交易
 *
 * 与 SwapController 共用 /swaps 前缀，路由不冲突（reconcile/backfill 为 POST 静态/二级路径）。
 */
@Controller('swaps')
export class SwapReconcilerController {
  constructor(private readonly reconciler: SwapReconcilerService) {}

  @Post('reconcile')
  reconcilePending(
    @Query('chainId') chainId?: string,
    @Query('limit') limit?: string,
  ): Promise<ReconcileBatchResult> {
    return this.reconciler.reconcilePending(
      chainId !== undefined ? Number(chainId) : undefined,
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  @Post('backfill')
  backfill(@Query('limit') limit?: string): Promise<BackfillResult> {
    return this.reconciler.backfillFromEvents(
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  @Post(':id/reconcile')
  reconcileOne(@Param('id') id: string): Promise<ReconcileResult> {
    return this.reconciler.reconcileSwap(id);
  }
}
