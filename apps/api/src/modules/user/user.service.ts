import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { SwapEvent, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  buildExplorerTxUrl,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import {
  BASE_MAINNET_TOKENS,
  BASE_SEPOLIA_TOKENS,
} from '../../chain/token-catalog';
import { parseDecimal } from '../../dex/math';
import { formatUnits } from '../../common/utils/units';
import { DataAuthenticity } from '../../common/constants/data-authenticity';
import { MarketService } from '../market/market.service';
import { INDEXER_CHAIN_ID } from '../../indexer/indexer.constants';
import { SwapStatus, isTerminalStatus } from '../swap/swap.types';
import {
  deriveSwapDirection,
  parseSwapEventData,
  swapEventHasParticipant,
} from '../swap/swap-event.util';
import {
  toUserProfileDto,
  type PortfolioDto,
  type PortfolioTokenDto,
  type UserProfileDto,
  type UserStats,
  type UserSwapListResult,
  type UserSwapRecordDto,
} from './user.types';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** USD 估值定点小数位数（指数，BigInt 定点运算，禁 Float）。 */
const VALUE_DECIMALS = 18n;
/** 10^VALUE_DECIMALS 定点基数（乘法回退精度用）。 */
const VALUE_BASE = 10n ** VALUE_DECIMALS;

/** 定点小数乘法：a × b（18 位精度），输出十进制字符串去尾零。 */
function mulDecimal(a: string, b: string): string {
  const x = parseDecimal(a, VALUE_DECIMALS);
  const y = parseDecimal(b, VALUE_DECIMALS);
  return formatUnits(((x * y) / VALUE_BASE).toString(), 18);
}

/** Portfolio 聚合所需的 token 元信息（目录 ∪ DB，合并去重）。 */
interface PortfolioTokenMeta {
  address: string; // 小写
  symbol: string | null;
  name: string | null;
  decimals: number;
  logoURI: string | null;
}

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly erc20: Erc20ReaderService,
    private readonly market: MarketService,
  ) {}

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

  // ---------- 资产中心（Portfolio） ----------

  /**
   * 查询钱包在指定链上的多 token 余额 + USD 估值。
   *
   * 遍历「token 目录 ∪ DB Token 表」合并去重后的所有 token，逐个读链上余额，
   * 只保留 balance > 0 的 token，并对每个有余额的 token 调用 MarketService 拿
   * 价格，用 BigInt 定点运算计算 valueUsd = balanceFormatted × priceUsd。
   *
   * 降级策略：单个 token 读余额 / 读价格失败不抛 500，失败的余额跳过、
   * 失败的价格置 null + authenticity=UNAVAILABLE，至少返回能读到的 token。
   */
  async getPortfolio(
    walletAddress: string,
    chainId?: number,
  ): Promise<PortfolioDto> {
    const address = this.assertAddress(walletAddress);
    const resolvedChainId = this.resolveChainId(chainId);

    const tokens = await this.loadPortfolioTokens(resolvedChainId);
    const items: PortfolioTokenDto[] = [];

    for (const token of tokens) {
      // 1) 读余额：单个失败跳过，不拖垮整体
      let balance: bigint;
      try {
        balance = await this.erc20.readBalance(
          resolvedChainId,
          token.address,
          address,
        );
      } catch (err) {
        this.logger.warn(
          `Portfolio 读余额失败（chain=${resolvedChainId} token=${token.address}）: ${this.errMsg(err)}`,
        );
        continue;
      }
      if (balance <= 0n) {
        continue;
      }

      const balanceFormatted = formatUnits(balance.toString(), token.decimals);

      // 2) 读价格：失败 → priceUsd=null / valueUsd=null / authenticity=UNAVAILABLE，token 仍保留
      let priceUsd: string | null = null;
      let authenticity: DataAuthenticity = DataAuthenticity.UNAVAILABLE;
      let valueUsd: string | null = null;
      try {
        const price = await this.market.getTokenPrice(
          resolvedChainId,
          token.address,
        );
        priceUsd = price.priceUsd;
        authenticity = price.authenticity;
        if (priceUsd !== null) {
          valueUsd = mulDecimal(balanceFormatted, priceUsd);
        }
      } catch (err) {
        this.logger.warn(
          `Portfolio 读价格失败（chain=${resolvedChainId} token=${token.address}）: ${this.errMsg(err)}`,
        );
      }

      items.push({
        chainId: resolvedChainId,
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoURI: token.logoURI,
        balance: balance.toString(),
        balanceFormatted,
        priceUsd,
        valueUsd,
        authenticity,
      });
    }

    // 3) 汇总 totalValueUsd（BigInt 定点求和）
    let totalScaled = 0n;
    let hasValue = false;
    for (const item of items) {
      if (item.valueUsd !== null) {
        totalScaled += parseDecimal(item.valueUsd, VALUE_DECIMALS);
        hasValue = true;
      }
    }
    const totalValueUsd = hasValue
      ? formatUnits(totalScaled.toString(), 18)
      : null;

    return { address, chainId: resolvedChainId, items, totalValueUsd };
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

  // ---------- Portfolio 数据加载 ----------

  /** 合并「token 目录 ∪ DB Token 表」并按地址去重（目录优先，decimals 最可信）。 */
  private async loadPortfolioTokens(
    chainId: number,
  ): Promise<PortfolioTokenMeta[]> {
    const byAddress = new Map<string, PortfolioTokenMeta>();

    // 1) token 目录（优先）
    const catalogTokens =
      chainId === BASE_SEPOLIA_CHAIN_ID
        ? BASE_SEPOLIA_TOKENS
        : BASE_MAINNET_TOKENS;
    for (const t of catalogTokens) {
      const address = normalizeAddress(t.address);
      byAddress.set(address, {
        address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoURI: t.logoURI ?? null,
      });
    }

    // 2) DB Token 表（仅补目录没有的地址）
    try {
      const rows = await this.prisma.token.findMany({
        where: { chain_id: chainId },
        select: {
          address: true,
          symbol: true,
          name: true,
          decimals: true,
          logo_uri: true,
        },
      });
      for (const row of rows) {
        const address = normalizeAddress(row.address);
        if (byAddress.has(address)) {
          continue;
        }
        byAddress.set(address, {
          address,
          symbol: row.symbol,
          name: row.name,
          decimals: row.decimals,
          logoURI: row.logo_uri ?? null,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Portfolio 读取 Token 表失败（chain=${chainId}）: ${this.errMsg(err)}`,
      );
    }

    return [...byAddress.values()];
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

  /** 解析 chainId（默认 Base Mainnet）并校验合法性。 */
  private resolveChainId(chainId?: number): number {
    const resolved = chainId ?? BASE_MAINNET_CHAIN_ID;
    if (!isSupportedChainId(resolved)) {
      throw new BadRequestException(
        `不支持的 chainId: ${resolved}（支持 8453 / 84532）`,
      );
    }
    return resolved;
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
