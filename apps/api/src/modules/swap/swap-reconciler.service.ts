import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Pool, Swap, SwapEvent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { ChainReadError } from '../../chain/chain.errors';
import { isSupportedChainId } from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { ErrorCodes } from '../../common/constants/error-codes';
import { isTerminalStatus, SwapStatus } from './swap.types';

/**
 * 交易对账与回填服务（Sprint 8）。
 *
 * 两条链路：
 * 1. 链上状态核验（reconcile）：对 PENDING 交易查 RPC 回执，落到 CONFIRMED / REVERTED，
 *    保证 swaps.status 与链上一致、可核验。
 * 2. 事件回填（backfill）：消费 Indexer 写入的 swap_events（event_type=Swap 且 swap_id 为空），
 *    按 tx_hash 分组、解析事件参数 → 派生 tokenIn/tokenOut/amountIn/amountOut/user →
 *    upsert swaps 行 → 回填 swap_events.swap_id（按 @@unique([tx_hash, log_index])）。
 *
 * 可选后台循环：RECONCILER_AUTOSTART=true 时随 API 启动，按 RECONCILER_INTERVAL_MS 周期
 * 先回填、再核验（与 Indexer 后台循环同模式）。
 */

export interface ReconcileResult {
  id: string;
  txHash: string;
  chainId: number;
  fromStatus: string;
  toStatus: string;
  confirmedAt: string | null;
  note: string;
}

export interface ReconcileBatchResult {
  checked: number;
  confirmed: number;
  reverted: number;
  stillPending: number;
  failed: number;
}

export interface BackfillResult {
  processedTxs: number;
  createdSwaps: number;
  updatedSwaps: number;
  linkedEvents: number;
  skippedEvents: number;
}

/** 单个事件解析出的单跳交易。 */
interface DerivedHop {
  chainId: number;
  user: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  poolAddress: string;
  protocolType: string;
}

const DEFAULT_BACKFILL_LIMIT = 200;
const DEFAULT_RECONCILE_LIMIT = 100;
const DEFAULT_INTERVAL_MS = 30_000;

@Injectable()
export class SwapReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SwapReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: ChainRpcService,
  ) {}

  onModuleInit(): void {
    if (process.env.RECONCILER_AUTOSTART === 'true') {
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
    this.logger.log(`交易对账后台循环启动（interval=${interval}ms）`);
    this.timer = setInterval(() => {
      void this.runCycle();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('交易对账后台循环已停止');
  }

  private async runCycle(): Promise<void> {
    try {
      await this.backfillFromEvents(DEFAULT_BACKFILL_LIMIT);
      await this.reconcilePending(undefined, DEFAULT_RECONCILE_LIMIT);
    } catch (err) {
      this.logger.warn(
        `对账循环失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ---------- 链上状态核验 ----------

  /** 核验单笔交易：查回执，PENDING -> CONFIRMED / REVERTED。 */
  async reconcileSwap(id: string): Promise<ReconcileResult> {
    const swap = await this.prisma.swap.findUnique({ where: { id } });
    if (!swap) {
      throw new NotFoundException(`交易不存在（id=${id}）`);
    }
    if (isTerminalStatus(swap.status)) {
      return this.toResult(swap, swap.status, '已是终态，跳过');
    }
    if (swap.status !== SwapStatus.PENDING) {
      throw new BadRequestException(
        `当前状态 ${swap.status} 不可链上核验（仅 PENDING 可核验）`,
      );
    }

    const receipt = await this.fetchReceipt(swap.chain_id, swap.tx_hash);
    if (!receipt) {
      return this.toResult(swap, SwapStatus.PENDING, '尚未上链（receipt 为空）');
    }

    const toStatus =
      receipt.status === 'success' ? SwapStatus.CONFIRMED : SwapStatus.REVERTED;
    const updated = await this.prisma.swap.update({
      where: { id: swap.id },
      data: { status: toStatus, confirmed_at: new Date() },
    });
    return this.toResult(updated, toStatus, `回执 status=${receipt.status}`);
  }

  /** 批量核验所有 PENDING 交易（可指定链 + 条数上限）。 */
  async reconcilePending(
    chainId?: number,
    limit = DEFAULT_RECONCILE_LIMIT,
  ): Promise<ReconcileBatchResult> {
    if (chainId !== undefined) {
      this.assertChainId(chainId);
    }
    const where: Prisma.SwapWhereInput = { status: SwapStatus.PENDING };
    if (chainId !== undefined) {
      where.chain_id = chainId;
    }

    const rows = await this.prisma.swap.findMany({
      where,
      orderBy: { created_at: 'asc' },
      take: limit,
    });

    const summary: ReconcileBatchResult = {
      checked: rows.length,
      confirmed: 0,
      reverted: 0,
      stillPending: 0,
      failed: 0,
    };

    for (const row of rows) {
      try {
        const receipt = await this.fetchReceipt(row.chain_id, row.tx_hash);
        if (!receipt) {
          summary.stillPending += 1;
          continue;
        }
        if (receipt.status === 'success') {
          await this.prisma.swap.update({
            where: { id: row.id },
            data: { status: SwapStatus.CONFIRMED, confirmed_at: new Date() },
          });
          summary.confirmed += 1;
        } else {
          await this.prisma.swap.update({
            where: { id: row.id },
            data: { status: SwapStatus.REVERTED, confirmed_at: new Date() },
          });
          summary.reverted += 1;
        }
      } catch (err) {
        summary.failed += 1;
        this.logger.warn(
          `核验交易失败（id=${row.id} tx=${row.tx_hash}）: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return summary;
  }

  // ---------- 事件回填（消费 Indexer swap_events） ----------

  async backfillFromEvents(limit = DEFAULT_BACKFILL_LIMIT): Promise<BackfillResult> {
    const events = await this.prisma.swapEvent.findMany({
      where: { event_type: 'Swap', swap_id: null },
      orderBy: [{ tx_hash: 'asc' }, { log_index: 'asc' }],
      take: limit,
    });

    // 按 tx_hash 分组（保持 log_index 升序，多跳顺序正确）
    const groups = new Map<string, SwapEvent[]>();
    for (const e of events) {
      const arr = groups.get(e.tx_hash) ?? [];
      arr.push(e);
      groups.set(e.tx_hash, arr);
    }

    const summary: BackfillResult = {
      processedTxs: groups.size,
      createdSwaps: 0,
      updatedSwaps: 0,
      linkedEvents: 0,
      skippedEvents: 0,
    };

    for (const [txHash, evs] of groups) {
      try {
        const parsed = evs.map((e) => {
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(e.event_data) as Record<string, unknown>;
          } catch {
            data = {};
          }
          return { event: e, data };
        });

        const pools = await this.loadPools(parsed.map((p) => p.data.poolId));
        const hops = parsed
          .map((p) => this.deriveHop(p.data, pools.get(String(p.data.poolId))))
          .filter((h): h is DerivedHop => h !== null);

        if (hops.length === 0) {
          summary.skippedEvents += evs.length;
          continue;
        }

        const first = hops[0];
        const last = hops[hops.length - 1];
        const user = first.user;
        const chainId = first.chainId;
        const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

        const existing = await this.prisma.swap.findUnique({
          where: { tx_hash: txHash },
        });
        let swap: Swap;
        if (existing) {
          swap = await this.prisma.swap.update({
            where: { id: existing.id },
            data: {
              user_address: user,
              token_in: first.tokenIn,
              token_out: last.tokenOut,
              amount_in: d(first.amountIn),
              amount_out: d(last.amountOut),
              chain_id: chainId,
            },
          });
          summary.updatedSwaps += 1;
        } else {
          swap = await this.prisma.swap.create({
            data: {
              user_address: user,
              token_in: first.tokenIn,
              token_out: last.tokenOut,
              amount_in: d(first.amountIn),
              amount_out: d(last.amountOut),
              tx_hash: txHash,
              status: SwapStatus.PENDING,
              chain_id: chainId,
            },
          });
          summary.createdSwaps += 1;
        }

        // 自动注册用户
        await this.prisma.user.upsert({
          where: { wallet_address: user },
          update: {},
          create: { wallet_address: user },
        });

        // 回填 swap_events.swap_id（幂等键 tx_hash + log_index）
        for (const ev of evs) {
          await this.prisma.swapEvent.update({
            where: {
              tx_hash_log_index: { tx_hash: ev.tx_hash, log_index: ev.log_index },
            },
            data: { swap_id: swap.id },
          });
          summary.linkedEvents += 1;
        }
      } catch (err) {
        summary.skippedEvents += evs.length;
        this.logger.warn(
          `回填交易失败（tx=${txHash}）: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return summary;
  }

  // ---------- 私有 ----------

  private async loadPools(ids: unknown[]): Promise<Map<string, Pool>> {
    const unique = [
      ...new Set(ids.map((i) => String(i)).filter((s) => s.length > 0)),
    ];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.pool.findMany({ where: { id: { in: unique } } });
    return new Map(rows.map((p) => [p.id, p]));
  }

  private deriveHop(
    data: Record<string, unknown>,
    pool: Pool | undefined,
  ): DerivedHop | null {
    if (!pool) {
      return null;
    }
    const user = this.safeAddress(data.recipient ?? data.to ?? data.sender);
    if (!user) {
      return null;
    }
    const family = String(data.family ?? '');
    const hop =
      family === 'cl'
        ? this.deriveClHop(data, pool, user)
        : this.deriveClassicHop(data, pool, user);
    return hop;
  }

  private deriveClassicHop(
    data: Record<string, unknown>,
    pool: Pool,
    user: string,
  ): DerivedHop | null {
    const amount0In = this.bigintOf(data.amount0In);
    const amount1In = this.bigintOf(data.amount1In);
    const amount0Out = this.bigintOf(data.amount0Out);
    const amount1Out = this.bigintOf(data.amount1Out);

    const tokenIn = amount0In > 0n ? pool.token0_address : pool.token1_address;
    const tokenOut = amount0Out > 0n ? pool.token0_address : pool.token1_address;
    const amountIn = (amount0In > 0n ? amount0In : amount1In).toString();
    const amountOut = (amount0Out > 0n ? amount0Out : amount1Out).toString();
    if (BigInt(amountIn) <= 0n || BigInt(amountOut) <= 0n) {
      return null;
    }

    return {
      chainId: pool.chain_id,
      user,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      poolAddress: pool.pool_address,
      protocolType: String(data.protocolType ?? ''),
    };
  }

  private deriveClHop(
    data: Record<string, unknown>,
    pool: Pool,
    user: string,
  ): DerivedHop | null {
    const amount0 = this.bigintOf(data.amount0);
    const amount1 = this.bigintOf(data.amount1);
    // CL 金额带符号：>0 流入池子（用户付出），<0 流出池子（用户收到）
    if (amount0 === 0n || amount1 === 0n) {
      return null;
    }
    const tokenIn = amount0 > 0n ? pool.token0_address : pool.token1_address;
    const tokenOut = amount0 < 0n ? pool.token0_address : pool.token1_address;
    const amountIn = (amount0 > 0n ? amount0 : amount1).toString();
    const amountOut = (amount0 < 0n ? -amount0 : -amount1).toString();
    if (BigInt(amountIn) <= 0n || BigInt(amountOut) <= 0n) {
      return null;
    }

    return {
      chainId: pool.chain_id,
      user,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      poolAddress: pool.pool_address,
      protocolType: String(data.protocolType ?? ''),
    };
  }

  private bigintOf(v: unknown): bigint {
    const s = String(v ?? '0').trim();
    try {
      return BigInt(s);
    } catch {
      return 0n;
    }
  }

  private safeAddress(v: unknown): string | null {
    if (typeof v !== 'string') {
      return null;
    }
    const s = v.trim();
    return isValidAddress(s) ? normalizeAddress(s) : null;
  }

  private toResult(swap: Swap, toStatus: string, note: string): ReconcileResult {
    return {
      id: swap.id,
      txHash: swap.tx_hash,
      chainId: swap.chain_id,
      fromStatus: swap.status,
      toStatus,
      confirmedAt: swap.confirmed_at ? swap.confirmed_at.toISOString() : null,
      note,
    };
  }

  private async fetchReceipt(
    chainId: number,
    txHash: string,
  ): Promise<{ status: 'success' | 'reverted' } | null> {
    try {
      const receipt = await this.rpc
        .getClient(chainId)
        .getTransactionReceipt({ hash: txHash as `0x${string}` });
      return receipt ? { status: receipt.status } : null;
    } catch (err) {
      const message =
        err instanceof ChainReadError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      throw new HttpException(
        { code: ErrorCodes.RPC_UNAVAILABLE, message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private assertChainId(chainId: number): void {
    if (!isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
  }

  private intervalMs(): number {
    const raw = Number(process.env.RECONCILER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_INTERVAL_MS;
  }
}
