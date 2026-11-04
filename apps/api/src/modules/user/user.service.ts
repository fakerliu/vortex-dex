import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { SwapEvent, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { buildExplorerTxUrl, isSupportedChainId } from '../../chain/chain.constants';
import { INDEXER_CHAIN_ID } from '../../indexer/indexer.constants';
import { SwapStatus, isTerminalStatus } from '../swap/swap.types';
import {
  deriveSwapDirection,
  parseSwapEventData,
  swapEventHasParticipant,
} from '../swap/swap-event.util';
import {
  toUserProfileDto,
  type UserProfileDto,
  type UserStats,
  type UserSwapListResult,
  type UserSwapRecordDto,
} from './user.types';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * 用户系统（Sprint 8 交易记录与用户系统）。
 *
 * - register：按钱包地址幂等 upsert 用户。
 * - getProfile：钱包地址识别 + 交易统计（swaps ∪ swap_events，按 tx_hash 去重）。
 * - getUserSwaps：用户交易列表（平台提交 + 链上原始事件合并，按时间倒序分页）。
 *
 * 注意：swap_events.event_data 是 JSON 字符串（非原生 Jsonb），无法在 SQL 里按参与者过滤，
 * 因此链上事件按「最近 N 条 Swap 事件」加载后在内存里按 sender/recipient 过滤。
 * 生产环境建议将 event_data 改为 Jsonb + GIN 索引，或单独维护「参与者」表。
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 幂等注册 / 获取用户，返回档案。 */
  async register(walletAddress: string): Promise<UserProfileDto> {
    const address = this.assertAddress(walletAddress);
    const user = await this.upsertUser(address);
    const stats = await this.stats(address);
    return toUserProfileDto(address, user, stats);
  }

  /** 钱包地址识别 + 交易统计（不要求已注册）。 */
  async getProfile(walletAddress: string): Promise<UserProfileDto> {
    const address = this.assertAddress(walletAddress);
    const user = await this.prisma.user.findUnique({
      where: { wallet_address: address },
    });
    const stats = await this.stats(address);
    return toUserProfileDto(address, user, stats);
  }

  /** 幂等 upsert（供其他模块复用，如提交交易时自动注册）。 */
  async upsertUser(address: string): Promise<User> {
    return this.prisma.user.upsert({
      where: { wallet_address: address },
      update: {},
      create: { wallet_address: address },
    });
  }

  /** 用户交易列表（平台 swaps + 链上 swap_events 合并，按时间倒序分页）。 */
  async getUserSwaps(
    walletAddress: string,
    chainId?: number,
    page?: number,
    limit?: number,
  ): Promise<UserSwapListResult> {
    const owner = this.assertAddress(walletAddress);
    const p = this.normalizePage(page);
    const l = this.normalizeLimit(limit);
    this.assertChainIdIfPresent(chainId);

    // 链上事件只来自 Indexer（目前仅 Base Mainnet）
    const includeChain = chainId === undefined || chainId === INDEXER_CHAIN_ID;

    const platformRows = await this.prisma.swap.findMany({
      where: {
        user_address: owner,
        ...(chainId !== undefined ? { chain_id: chainId } : {}),
      },
      orderBy: { created_at: 'desc' },
    });

    const chainEvents = includeChain
      ? await this.loadUserChainEvents(owner)
      : [];
    const poolTokens = await this.loadPoolTokens(chainEvents);

    const chainByTx = new Map<string, SwapEvent[]>();
    for (const e of chainEvents) {
      const arr = chainByTx.get(e.tx_hash) ?? [];
      arr.push(e);
      chainByTx.set(e.tx_hash, arr);
    }

    const records: UserSwapRecordDto[] = [];
    const seenTx = new Set<string>();

    // 1) 平台记录：优先保留平台上下文，链上事件用于补状态/区块/池子
    for (const s of platformRows) {
      seenTx.add(s.tx_hash);
      const evs = chainByTx.get(s.tx_hash) ?? [];
      let status = s.status;
      let confirmedAt = s.confirmed_at;
      const blockNumber: number | null = evs.length > 0 ? evs[0].block_number : null;

      if (!isTerminalStatus(status) && evs.length > 0) {
        status = SwapStatus.CONFIRMED;
        confirmedAt = confirmedAt ?? evs[0].created_at;
        await this.persistStatus(s.id, status, confirmedAt);
        await this.backfillEventSwapId(s.id, s.tx_hash);
      }

      const firstEv = evs.length > 0 ? parseSwapEventData(evs[0].event_data) : null;
      records.push({
        id: s.id,
        source: 'platform',
        txHash: s.tx_hash,
        chainId: s.chain_id,
        tokenIn: s.token_in,
        tokenOut: s.token_out,
        amountIn: s.amount_in.toString(),
        amountOut: s.amount_out.toString(),
        status,
        blockNumber,
        timestamp: (confirmedAt ?? s.created_at).toISOString(),
        explorerUrl: buildExplorerTxUrl(s.chain_id, s.tx_hash),
        pool: firstEv?.pool || null,
        protocolType: firstEv?.protocolType || null,
      });
    }

    // 2) 链上原始事件（无平台记录）：按 tx_hash 聚合，取首跳入 / 末跳出
    for (const [txHash, evs] of chainByTx) {
      if (seenTx.has(txHash)) {
        continue;
      }
      const sorted = [...evs].sort((a, b) => a.log_index - b.log_index);
      const first = parseSwapEventData(sorted[0].event_data);
      const last = parseSwapEventData(sorted[sorted.length - 1].event_data);
      const ptFirst = poolTokens.get(first.poolId);
      const ptLast = poolTokens.get(last.poolId);
      const dirIn = ptFirst
        ? deriveSwapDirection(first, ptFirst.token0, ptFirst.token1)
        : null;
      const dirOut = ptLast
        ? deriveSwapDirection(last, ptLast.token0, ptLast.token1)
        : null;

      records.push({
        id: sorted[0].id,
        source: 'chain',
        txHash,
        chainId: INDEXER_CHAIN_ID,
        tokenIn: dirIn?.tokenIn ?? '',
        tokenOut: dirOut?.tokenOut ?? '',
        amountIn: dirIn?.amountIn ?? '0',
        amountOut: dirOut?.amountOut ?? '0',
        status: SwapStatus.CONFIRMED,
        blockNumber: sorted[0].block_number,
        timestamp: sorted[0].created_at.toISOString(),
        explorerUrl: buildExplorerTxUrl(INDEXER_CHAIN_ID, txHash),
        pool: first.pool || null,
        protocolType: first.protocolType || null,
      });
    }

    // 3) 按时间倒序分页
    records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const total = records.length;
    const items = records.slice((p - 1) * l, p * l);

    return { items, page: p, limit: l, total };
  }

  // ---------- 统计 ----------

  private async stats(address: string): Promise<UserStats> {
    const swaps = await this.prisma.swap.findMany({
      where: { user_address: address },
      select: { tx_hash: true, status: true },
    });
    const chainEvents = await this.loadUserChainEvents(address);
    const chainTxs = new Set(chainEvents.map((e) => e.tx_hash));

    // 状态以链上为准：非终态 + 已有 Indexer 事件 → 视为已确认
    const statusByTx = new Map<string, string>();
    for (const s of swaps) {
      const effectiveStatus =
        !isTerminalStatus(s.status) && chainTxs.has(s.tx_hash)
          ? SwapStatus.CONFIRMED
          : s.status;
      statusByTx.set(s.tx_hash, effectiveStatus);
    }
    for (const tx of chainTxs) {
      if (!statusByTx.has(tx)) {
        statusByTx.set(tx, SwapStatus.CONFIRMED);
      }
    }

    let confirmed = 0;
    let failed = 0;
    let pending = 0;
    for (const st of statusByTx.values()) {
      if (st === SwapStatus.CONFIRMED) {
        confirmed += 1;
      } else if (st === SwapStatus.FAILED || st === SwapStatus.REVERTED) {
        failed += 1;
      } else {
        pending += 1;
      }
    }

    return {
      totalSwaps: statusByTx.size,
      confirmed,
      failed,
      pending,
      sourcePlatform: swaps.length,
      sourceChain: chainTxs.size,
    };
  }

  // ---------- 链上事件加载 ----------

  /** 加载用户参与的链上 Swap 事件（在内存里按参与者过滤，详见类注释）。 */
  private async loadUserChainEvents(owner: string): Promise<SwapEvent[]> {
    const events = await this.prisma.swapEvent.findMany({
      where: { event_type: 'Swap' },
      orderBy: { block_number: 'desc' },
      take: this.eventScanLimit(),
    });
    return events.filter((e) =>
      swapEventHasParticipant(parseSwapEventData(e.event_data), owner),
    );
  }

  private async loadPoolTokens(
    events: SwapEvent[],
  ): Promise<Map<string, { token0: string; token1: string }>> {
    const map = new Map<string, { token0: string; token1: string }>();
    const poolIds = [
      ...new Set(
        events
          .map((e) => parseSwapEventData(e.event_data).poolId)
          .filter((id) => id.length > 0),
      ),
    ];
    if (poolIds.length === 0) {
      return map;
    }
    const pools = await this.prisma.pool.findMany({
      where: { id: { in: poolIds } },
      select: { id: true, token0_address: true, token1_address: true },
    });
    for (const p of pools) {
      map.set(p.id, { token0: p.token0_address, token1: p.token1_address });
    }
    return map;
  }

  private eventScanLimit(): number {
    const raw = Number(process.env.USER_SWAP_EVENT_SCAN_LIMIT ?? 5000);
    return Number.isInteger(raw) && raw > 0 ? raw : 5000;
  }

  // ---------- 持久化（best-effort，不阻塞读） ----------

  private async persistStatus(
    id: string,
    status: string,
    confirmedAt: Date | null,
  ): Promise<void> {
    try {
      await this.prisma.swap.update({
        where: { id },
        data: {
          status,
          ...(confirmedAt ? { confirmed_at: confirmedAt } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`更新交易状态失败（id=${id}）: ${this.errMsg(err)}`);
    }
  }

  private async backfillEventSwapId(id: string, txHash: string): Promise<void> {
    try {
      await this.prisma.swapEvent.updateMany({
        where: { tx_hash: txHash, swap_id: null },
        data: { swap_id: id },
      });
    } catch (err) {
      this.logger.warn(
        `回填 swap_events.swap_id 失败（tx=${txHash}）: ${this.errMsg(err)}`,
      );
    }
  }

  // ---------- 校验 ----------

  private assertAddress(address: string): string {
    if (!isValidAddress(address)) {
      throw new BadRequestException(`钱包地址不合法: ${address}`);
    }
    return normalizeAddress(address);
  }

  private assertChainIdIfPresent(chainId?: number): void {
    if (chainId !== undefined && !isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
  }

  private normalizePage(page?: number): number {
    const p = page ?? DEFAULT_PAGE;
    if (!Number.isInteger(p) || p < 1) {
      throw new BadRequestException('page 必须是 >= 1 的整数');
    }
    return p;
  }

  private normalizeLimit(limit?: number): number {
    const l = limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(l) || l < 1) {
      throw new BadRequestException('limit 必须是 >= 1 的整数');
    }
    return Math.min(l, MAX_LIMIT);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
