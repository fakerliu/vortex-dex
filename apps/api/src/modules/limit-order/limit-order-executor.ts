import { Injectable, Logger } from '@nestjs/common';
import type { LimitOrder } from '@prisma/client';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import type { PoolQuoteCandidate } from '../../dex/dex-pool.service';
import { SwapService } from '../swap/swap.service';

/** 执行器抽象注入 token（接口无运行时，需显式 token 绑定）。 */
export const LIMIT_ORDER_EXECUTOR = 'LimitOrderExecutor';

/**
 * 限价单执行器抽象（架构 §10.2）。
 * 业务层（keeper / service）只面向本接口编程，Phase 2 换 OnChainSettlementExecutor
 * 时无需重写盯价、状态机、API。
 */
export interface LimitOrderExecutor {
  /**
   * 触发后执行成交（Phase 1 = 广播用户预签交易），返回成交 txHash。
   * 广播失败 / 不可重试时抛错，由 keeper 决定标记 failed。
   */
  fill(order: LimitOrder, quote: PoolQuoteCandidate): Promise<{ txHash: string }>;

  /**
   * 查询成交回执，驱动 triggered -> filled / failed。
   * 返回 pending 表示尚未上链（keeper 下轮继续对账）。
   */
  reconcile(
    order: LimitOrder,
  ): Promise<{ status: 'filled' | 'failed' | 'pending'; reason?: string }>;
}

/**
 * Phase 1 实现：广播用户预签交易（无执行私钥）。
 * - fill：若有 signed_approval_tx 先广播（并立即读一次回执，revert 则快速失败），
 *   再广播 signed_swap_tx。广播 = eth_sendRawTransaction，无需任何私钥。
 * - reconcile：复用 SwapService.tryReadReceipt 读链上回执。
 */
@Injectable()
export class PreSignedTxExecutor implements LimitOrderExecutor {
  private readonly logger = new Logger(PreSignedTxExecutor.name);

  constructor(
    private readonly rpc: ChainRpcService,
    private readonly swapService: SwapService,
  ) {}

  async fill(
    order: LimitOrder,
    _quote: PoolQuoteCandidate,
  ): Promise<{ txHash: string }> {
    if (order.signed_approval_tx) {
      const approvalHash = await this.rpc.sendRawTransaction(
        order.chain_id,
        order.signed_approval_tx,
      );
      this.logger.log(
        `广播 approve 交易（order=${order.id} tx=${approvalHash}）`,
      );
      // 立即读一次回执：approve revert 时快速失败，不浪费 gas 广播注定 revert 的 swap。
      const receipt = await this.swapService.tryReadReceipt(
        order.chain_id,
        approvalHash,
      );
      if (receipt && receipt !== 'rpc_error' && receipt.status === 'reverted') {
        throw new Error('approve 交易 revert');
      }
      // 回执尚为 null（未上链）时继续广播 swap：nonce 连续保证 approve 先于 swap 打包，
      // swap 的最终结果由 reconcile 兜底对账。
    }

    if (!order.signed_swap_tx) {
      throw new Error('订单未武装（缺少 signed_swap_tx）');
    }
    const txHash = await this.rpc.sendRawTransaction(
      order.chain_id,
      order.signed_swap_tx,
    );
    this.logger.log(`广播 swap 交易（order=${order.id} tx=${txHash}）`);
    return { txHash };
  }

  async reconcile(
    order: LimitOrder,
  ): Promise<{ status: 'filled' | 'failed' | 'pending'; reason?: string }> {
    if (!order.tx_hash) {
      return { status: 'pending' };
    }
    const receipt = await this.swapService.tryReadReceipt(
      order.chain_id,
      order.tx_hash,
    );
    if (receipt === 'rpc_error') {
      return { status: 'pending' };
    }
    if (!receipt) {
      return { status: 'pending' };
    }
    if (receipt.status === 'success') {
      return { status: 'filled' };
    }
    return { status: 'failed', reason: 'revert' };
  }
}
