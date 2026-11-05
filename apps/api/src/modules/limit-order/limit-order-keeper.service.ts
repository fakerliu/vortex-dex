import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { LimitOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import { DexPoolService } from '../../dex/dex-pool.service';
import type { PoolQuoteCandidate } from '../../dex/dex-pool.service';
import { LimitOrderStatus } from './limit-order.types';
import type { KeeperRunResultDto } from './limit-order.types';
import { LimitOrderService } from './limit-order.service';
import { extractSwapTarget } from './limit-order.signer';
import {
  LIMIT_ORDER_EXECUTOR,
  type LimitOrderExecutor,
} from './limit-order-executor';

const DEFAULT_INTERVAL_MS = 15_000;

type FillOutcome = 'triggered' | 'filled' | 'failed' | 'skipped';

/**
 * 限价单 keeper 盯价循环（V1.4 Phase 1 链下模式，架构 §六）。
 *
 * - setInterval 轮询 + running 防重入（与 Indexer / SwapReconciler 同模式，无外部调度）。
 * - sweepExpired：清扫过期单（pending -> expired）。
 * - scanAndFill：对 armed pending 单盯价 → 触发判定 → CAS 抢占 → 广播 → 回执对账。
 * - reconcileTriggered：对已广播但未确认的 triggered 单继续对账（崩溃恢复 / 下一轮）。
 *
 * 非托管铁律：本服务无任何私钥，只调用 executor 广播用户预签交易。
 */
@Injectable()
export class LimitOrderKeeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LimitOrderKeeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly poolService: DexPoolService,
    private readonly erc20: Erc20ReaderService,
    private readonly service: LimitOrderService,
    @Inject(LIMIT_ORDER_EXECUTOR)
    private readonly executor: LimitOrderExecutor,
  ) {}

  // ---------- 生命周期 ----------

  onModuleInit(): void {
    if (this.autostart()) {
      this.start();
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    const interval = this.intervalMs();
    this.logger.log(`限价单 keeper 后台循环启动（interval=${interval}ms）`);
    this.timer = setInterval(() => {
      void this.runCycle();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('限价单 keeper 后台循环已停止');
  }

  // ---------- 单轮 ----------

  async runCycle(): Promise<KeeperRunResultDto> {
    if (this.running) {
      return this.emptyResult();
    }
    this.running = true;
    const startedAt = new Date().toISOString();
    try {
      const sweptExpired = await this.sweepExpired();
      const scan = await this.scanAndFill();
      const reconciled = await this.reconcileTriggered();
      return {
        sweptExpired,
        triggered: scan.triggered,
        filled: scan.filled,
        failed: scan.failed,
        skipped: scan.skipped,
        reconciled,
        startedAt,
      };
    } catch (err) {
      this.logger.error(`keeper 单轮失败: ${this.errMsg(err)}`);
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** 清扫过期单：pending + expires_at < now -> expired（CAS，逐单通知）。 */
  async sweepExpired(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.limitOrder.findMany({
      where: { status: LimitOrderStatus.PENDING, expires_at: { lt: now } },
      select: { id: true },
    });

    let expired = 0;
    for (const c of candidates) {
      const res = await this.prisma.limitOrder.updateMany({
        where: { id: c.id, status: LimitOrderStatus.PENDING },
        data: { status: LimitOrderStatus.EXPIRED },
      });
      if (res.count === 1) {
        expired += 1;
        const row = await this.prisma.limitOrder.findUnique({
          where: { id: c.id },
        });
        if (row) {
          await this.service.notify(row, 'limit_order_expired', '限价单已过期');
        }
      }
    }
    return expired;
  }

  /** 对 armed pending 单盯价并尝试成交。 */
  async scanAndFill(): Promise<{
    triggered: number;
    filled: number;
    failed: number;
    skipped: number;
  }> {
    // MVP：armed pending 为天然小集合，逐单精确报价（架构 §6.2 允许的简化）。
    const orders = await this.prisma.limitOrder.findMany({
      where: {
        status: LimitOrderStatus.PENDING,
        signed_swap_tx: { not: null },
      },
      orderBy: { created_at: 'asc' },
    });

    const summary = { triggered: 0, filled: 0, failed: 0, skipped: 0 };
    for (const order of orders) {
      const outcome = await this.tryFill(order);
      if (outcome === 'triggered') {
        summary.triggered += 1;
      } else if (outcome === 'filled') {
        summary.filled += 1;
      } else if (outcome === 'failed') {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
    }
    return summary;
  }

  /** 对已广播未确认的 triggered 单继续对账（回执确认 -> filled，revert -> failed）。 */
  async reconcileTriggered(): Promise<number> {
    const orders = await this.prisma.limitOrder.findMany({
      where: { status: LimitOrderStatus.TRIGGERED, tx_hash: { not: null } },
      orderBy: { triggered_at: 'asc' },
    });

    let reconciled = 0;
    for (const order of orders) {
      const outcome = await this.executor.reconcile(order);
      if (outcome.status === 'filled') {
        await this.service.markFilled(
          order,
          order.tx_hash!,
          order.min_amount_out.toString(),
        );
        reconciled += 1;
      } else if (outcome.status === 'failed') {
        await this.service.markFailed(order, outcome.reason ?? 'revert');
        reconciled += 1;
      }
    }
    return reconciled;
  }

  // ---------- 单笔成交尝试 ----------

  private async tryFill(order: LimitOrder): Promise<FillOutcome> {
    // 1. 触发判定：实时报价 amountOut >= min_amount_out（架构 §6.3）。
    let quote: PoolQuoteCandidate | null;
    try {
      quote = await this.poolService.quoteBestForChain(
        order.chain_id,
        order.token_in,
        order.token_out,
        order.amount_in.toString(),
      );
    } catch (err) {
      this.logger.warn(`盯价失败（order=${order.id}）: ${this.errMsg(err)}`);
      return 'skipped';
    }
    if (!quote) {
      return 'skipped';
    }
    if (
      BigInt(quote.quote.amountOut) <
      BigInt(order.min_amount_out.toString())
    ) {
      return 'skipped';
    }

    // 2. 幂等 CAS：pending -> triggered（影响行数===1 才抢到，架构 §七）。
    const claimed = await this.service.claimTriggered(order.id);
    if (!claimed) {
      return 'skipped';
    }

    const fresh = await this.prisma.limitOrder.findUnique({
      where: { id: order.id },
    });
    if (!fresh || fresh.status !== LimitOrderStatus.TRIGGERED || !fresh.signed_swap_tx) {
      // CAS 之后、广播之前被撤单/过期，或状态异常：不再继续。
      return 'skipped';
    }

    // 3. 广播前有效性重检（架构 §8.3）：过期 / 余额 / 授权不足直接 failed，不广播注定 revert 的交易。
    if (fresh.expires_at && fresh.expires_at.getTime() <= Date.now()) {
      await this.service.markFailed(fresh, '订单已过期');
      return 'failed';
    }
    const funds = await this.recheckFunds(fresh);
    if (!funds.ok) {
      await this.service.markFailed(fresh, funds.reason);
      return 'failed';
    }

    // 4. 广播 + 记录 txHash + 回执对账。
    try {
      const { txHash } = await this.executor.fill(fresh, quote);
      await this.service.recordTxHash(fresh.id, txHash);

      const updated = await this.prisma.limitOrder.findUnique({
        where: { id: fresh.id },
      });
      if (!updated) {
        return 'failed';
      }
      const outcome = await this.executor.reconcile(updated);
      if (outcome.status === 'filled') {
        await this.service.markFilled(
          updated,
          updated.tx_hash ?? txHash,
          quote.quote.amountOut,
        );
        return 'filled';
      }
      if (outcome.status === 'failed') {
        await this.service.markFailed(updated, outcome.reason ?? 'revert');
        return 'failed';
      }
      // 回执尚未确认：留在 triggered，由下轮 reconcileTriggered 继续对账。
      return 'triggered';
    } catch (err) {
      const reason = this.classifyBroadcastError(err);
      await this.service.markFailed(fresh, reason);
      return 'failed';
    }
  }

  /** 广播前只读复核余额与授权（不足则失败，不广播注定 revert 的交易）。 */
  private async recheckFunds(
    order: LimitOrder,
  ): Promise<{ ok: boolean; reason: string }> {
    const amountIn = BigInt(order.amount_in.toString());
    try {
      const balance = await this.erc20.readBalance(
        order.chain_id,
        order.token_in,
        order.user_address,
      );
      if (balance < amountIn) {
        return { ok: false, reason: '余额不足' };
      }
      const spender = extractSwapTarget(order.signed_swap_tx!);
      const allowance = await this.erc20.readAllowance(
        order.chain_id,
        order.token_in,
        order.user_address,
        spender,
      );
      if (allowance < amountIn) {
        return { ok: false, reason: '授权不足' };
      }
      return { ok: true, reason: '' };
    } catch (err) {
      return { ok: false, reason: `复核失败: ${this.errMsg(err)}` };
    }
  }

  private classifyBroadcastError(err: unknown): string {
    const msg = this.errMsg(err);
    if (/approve.*revert/i.test(msg)) {
      return 'approve revert';
    }
    if (/nonce too low|nonce.*already|replacement transaction underpriced|nonce has already been used/i.test(msg)) {
      return 'nonce 失效';
    }
    return '广播失败';
  }

  // ---------- 工具 ----------

  private autostart(): boolean {
    return process.env.LIMIT_ORDER_KEEPER_AUTOSTART !== 'false';
  }

  private intervalMs(): number {
    const raw = Number(
      process.env.LIMIT_ORDER_KEEPER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_INTERVAL_MS;
  }

  private emptyResult(): KeeperRunResultDto {
    return {
      sweptExpired: 0,
      triggered: 0,
      filled: 0,
      failed: 0,
      skipped: 0,
      reconciled: 0,
      startedAt: new Date().toISOString(),
    };
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
