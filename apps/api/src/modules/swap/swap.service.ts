import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Swap, type SwapEvent } from '@prisma/client';
import type { TransactionReceipt } from 'viem';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import { Erc20ReaderService } from '../../chain/erc20-reader.service';
import { ChainReadError } from '../../chain/chain.errors';
import {
  BASE_MAINNET_CHAIN_ID,
  buildExplorerTxUrl,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { ErrorCodes } from '../../common/constants/error-codes';
import { DexPoolService } from '../../dex/dex-pool.service';
import { AerodromeClassicAdapter } from '../../dex/aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from '../../dex/aerodrome/aerodrome-cl.adapter';
import { UniswapV3Adapter } from '../../dex/uniswap-v3/uniswap-v3.adapter';
import {
  AERODROME_CLASSIC_ROUTER,
  AERODROME_PROTOCOL_TYPE_CL,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
  AERODROME_SWAP_ROUTER,
  DEFAULT_SWAP_GAS_LIMIT,
} from '../../dex/aerodrome/constants';
import {
  UNISWAP_V3_PROTOCOL_TYPE,
  UNISWAP_V3_SWAP_ROUTER,
} from '../../dex/uniswap-v3/constants';
import { combinePriceImpacts, parseAmount } from '../../dex/math';
import {
  buildApproveCalldata,
  buildClExactInput,
  buildClExactInputSingle,
  buildClassicSwapExactTokensForTokens,
  buildUniswapV3ExactInput,
  buildUniswapV3ExactInputSingle,
  classicRoute,
  encodeClPath,
  encodeUniswapV3Path,
  type BuiltTransaction,
} from '../../dex/calldata';
import {
  SwapStatus,
  isTerminalStatus,
  toSwapDto,
  type PrepareSwapRequestDto,
  type PrepareSwapResponseDto,
  type SubmitSwapRequestDto,
  type SwapChainEventDto,
  type SwapDetailDto,
  type SwapDto,
  type SwapHistoryResult,
  type SwapHopDto,
} from './swap.types';
import {
  deriveSwapDirection,
  parseSwapEventData,
} from './swap-event.util';
import { EventCollectorService } from '../analytics/event-collector.service';

const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 10_000;
const DEFAULT_DEADLINE_SECONDS = 1200; // 20 分钟
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** prepare 阶段允许的 submit 初始状态。 */
const SUBMIT_ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  SwapStatus.APPROVAL_REQUIRED,
  SwapStatus.APPROVED,
  SwapStatus.PENDING,
]);

/**
 * 交易执行服务（Sprint 6）。
 *
 * - prepare：取最新报价 + 查余额 + 查 allowance + 构造协议原生 Router calldata。
 * - submit：只接收公开 tx_hash 写库（非托管，不碰私钥/签名交易），状态 PENDING。
 * - 状态机定义见 swap.types.ts（SWAP_STATUS_TRANSITIONS）。
 */
@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: ChainRpcService,
    private readonly erc20: Erc20ReaderService,
    private readonly poolService: DexPoolService,
    private readonly classic: AerodromeClassicAdapter,
    private readonly cl: AerodromeClAdapter,
    private readonly uniswapV3: UniswapV3Adapter,
    private readonly events: EventCollectorService,
  ) {}

  // ---------- prepare ----------

  async prepare(req: PrepareSwapRequestDto): Promise<PrepareSwapResponseDto> {
    const chainId = this.resolveChainId(req.chainId);
    const tokenIn = this.assertAddress(req.tokenIn, 'tokenIn');
    const tokenOut = this.assertAddress(req.tokenOut, 'tokenOut');
    const user = this.assertAddress(req.userAddress, 'userAddress');
    if (tokenIn === tokenOut) {
      throw new BadRequestException('tokenIn 与 tokenOut 不能相同');
    }
    if (!/^\d+$/.test(req.amountIn.trim())) {
      throw new BadRequestException(
        'amountIn 必须为正整数字符串（链上原始单位，无小数）',
      );
    }
    const amountIn = parseAmount(req.amountIn);
    if (amountIn <= 0n) {
      throw new BadRequestException('amountIn 必须为正整数（链上原始单位）');
    }
    const slippageBps = this.normalizeSlippageBps(req.slippageBps);

    // 1. 解析执行路径（显式 route > pathId > 直接单跳最优）
    const path = await this.resolvePath(chainId, tokenIn, tokenOut, req);

    // 2. 逐跳重新报价（取最新报价，不信任旧 quote）
    const { hops, amountOut, priceImpact, gasLimit } = await this.quotePath(
      chainId,
      path.tokenPath,
      path.poolPath,
      path.protocolPath,
      req.amountIn,
    );

    // 3. 派生最小接受金额 + deadline
    const minimumReceived =
      (amountOut * (10_000n - BigInt(slippageBps))) / 10_000n;
    const deadline =
      Math.floor(Date.now() / 1000) + this.deadlineSeconds();

    // 4. 构造交易 calldata + 授权目标
    const { transaction, spender, protocol } = this.buildTransaction(
      hops,
      user,
      req.amountIn,
      minimumReceived.toString(),
      deadline,
      req.sqrtPriceLimitX96,
    );

    // 5. 查余额 + allowance（真实链上）
    const [balance, allowance] = await Promise.all([
      this.readBalance(chainId, tokenIn, user),
      this.readAllowance(chainId, tokenIn, user, spender),
    ]);

    const needsApproval = allowance < amountIn;
    const approvalAmount = amountIn.toString();

    // 6. 组装 approve calldata（仅需要时）
    let approval: PrepareSwapResponseDto['approval'] = null;
    if (needsApproval) {
      const approveTx = buildApproveCalldata({
        spender,
        amount: approvalAmount,
      });
      approval = {
        needed: true,
        token: tokenIn,
        spender,
        amount: approvalAmount,
        data: approveTx.data,
        functionName: approveTx.functionName,
        selector: approveTx.selector,
      };
    }

    const notes: string[] = [];
    if (balance < amountIn) {
      notes.push(
        `余额不足：${tokenIn} 余额 ${balance.toString()} < 需求 ${amountIn.toString()}`,
      );
    }

    return {
      chainId,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: req.amountIn,
      amountOut: amountOut.toString(),
      minimumReceived: minimumReceived.toString(),
      priceImpact,
      slippageBps,
      deadline,
      protocol,
      route: hops,
      balance: balance.toString(),
      allowance: allowance.toString(),
      spender,
      needsApproval,
      approvalAmount,
      transaction: {
        to: transaction.to,
        value: transaction.value,
        data: transaction.data,
        functionName: transaction.functionName,
        selector: transaction.selector,
        gasLimit,
      },
      approval,
      quoteTimestamp: new Date().toISOString(),
      notes,
    };
  }

  // ---------- submit / query ----------

  async submit(req: SubmitSwapRequestDto): Promise<SwapDto> {
    const chainId = this.resolveChainId(req.chainId);
    const user = this.assertAddress(req.userAddress, 'userAddress');
    const tokenIn = this.assertAddress(req.tokenIn, 'tokenIn');
    const tokenOut = this.assertAddress(req.tokenOut, 'tokenOut');
    if (tokenIn === tokenOut) {
      throw new BadRequestException('tokenIn 与 tokenOut 不能相同');
    }
    const txHash = this.assertTxHash(req.txHash);
    const amountIn = this.assertPositiveAmount(req.amountIn, 'amountIn');
    const amountOut = this.assertPositiveAmount(req.amountOut, 'amountOut');

    const status = this.normalizeSubmitStatus(req.status);

    // Sprint 8：自动注册用户（幂等），保证 GET /api/v1/users/:address 可用
    await this.prisma.user.upsert({
      where: { wallet_address: user },
      update: {},
      create: { wallet_address: user },
    });

    const d = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
    let row;
    try {
      row = await this.prisma.swap.create({
        data: {
          user_address: user,
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: d(amountIn),
          amount_out: d(amountOut),
          tx_hash: txHash,
          status,
          chain_id: chainId,
          // Analytics：意图 + 报价关联（可选）
          ...(req.intentId ? { intent_id: req.intentId } : {}),
          ...(req.quoteId ? { quote_id: req.quoteId } : {}),
        },
      });
    } catch (err) {
      // tx_hash 唯一约束：重复提交返回 409 而非 500
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`交易已存在（tx_hash=${txHash}）`);
      }
      throw err;
    }

    // Analytics 旁路：记录交易提交事件（失败不阻断）
    await this.events.track({
      eventName: 'transaction_submitted',
      chainId,
      walletAddress: user,
      intentId: req.intentId,
      properties: {
        swapId: row.id,
        txHash,
        tokenIn,
        tokenOut,
        amountIn,
        status,
      },
    });
    await this.events.recordIntent({
      intentId: req.intentId ?? `tx_${txHash}`,
      walletAddress: user,
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      quoteId: req.quoteId,
      status: 'submitted',
    });

    return toSwapDto(row);
  }

  /** 交易详情（Sprint 8 增强）：含链上回执状态同步、gas、失败原因、浏览器链接、关联链上事件。 */
  async getSwap(id: string): Promise<SwapDetailDto> {
    const row = await this.prisma.swap.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`交易不存在（id=${id}）`);
    }
    return this.buildSwapDetail(row);
  }

  // ---------- 交易详情与状态一致性（Sprint 8） ----------

  private async buildSwapDetail(row: Swap): Promise<SwapDetailDto> {
    const explorerUrl = buildExplorerTxUrl(row.chain_id, row.tx_hash);
    const events = await this.prisma.swapEvent.findMany({
      where: { tx_hash: row.tx_hash },
      orderBy: { log_index: 'asc' },
    });
    const poolTokens = await this.loadPoolTokens(events);

    let status = row.status as SwapStatus;
    let confirmedAt = row.confirmed_at;
    let blockNumber: number | null = null;
    let gasUsed: string | null = null;
    let effectiveGasPrice: string | null = null;
    let failureReason: string | null = null;
    let source: SwapDetailDto['statusSync']['source'] = 'none';

    const wasTerminal = isTerminalStatus(status);

    // 状态必须以链上为准：优先 RPC 回执（可判定 revert），回退到 Indexer 事件（已确认成功）。
    const receipt = await this.tryReadReceipt(row.chain_id, row.tx_hash);
    if (receipt === 'rpc_error') {
      source = 'rpc_error';
    } else if (receipt) {
      source = 'receipt';
      blockNumber = Number(receipt.blockNumber);
      gasUsed = receipt.gasUsed.toString();
      effectiveGasPrice = receipt.effectiveGasPrice?.toString() ?? null;
      if (receipt.status === 'success') {
        status = SwapStatus.CONFIRMED;
        failureReason = null;
        confirmedAt = confirmedAt ?? new Date();
      } else {
        status = SwapStatus.REVERTED;
        failureReason = await this.tryReadRevertReason(row.chain_id, row.tx_hash);
        confirmedAt = confirmedAt ?? new Date();
      }
    } else if (events.length > 0) {
      source = 'indexer';
      status = SwapStatus.CONFIRMED;
      blockNumber = events[0].block_number;
      confirmedAt = confirmedAt ?? events[0].created_at;
    } else {
      source = 'none';
    }

    // 非终态本地状态被链上确认时，持久化状态 + 回填 swap_events.swap_id
    if (!wasTerminal && isTerminalStatus(status)) {
      await this.persistStatus(row.id, status, confirmedAt);
      await this.backfillEventSwapId(row.id, row.tx_hash);
    } else if (events.length > 0 && !wasTerminal) {
      await this.backfillEventSwapId(row.id, row.tx_hash);
    }

    // Analytics：持久化 failure_reason + gas（链上回执信息落库）
    if (receipt && receipt !== 'rpc_error') {
      await this.persistReceiptMeta(
        row.id,
        failureReason,
        gasUsed,
        effectiveGasPrice,
        blockNumber,
      );
    }

    return {
      ...toSwapDto(row),
      status,
      confirmedAt: confirmedAt ? confirmedAt.toISOString() : null,
      blockNumber,
      gasUsed,
      effectiveGasPrice,
      failureReason,
      explorerUrl,
      chainEvents: events.map((e) => this.toChainEventDto(e, poolTokens)),
      statusSync: { source, syncedAt: new Date().toISOString() },
    };
  }

  private async tryReadReceipt(
    chainId: number,
    txHash: string,
  ): Promise<TransactionReceipt | null | 'rpc_error'> {
    try {
      const client = this.rpc.getClient(chainId);
      const receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      return receipt ?? null;
    } catch (err) {
      const msg = this.errMsg(err);
      // viem 对「交易不存在 / 尚未上链」抛 TransactionNotFoundError，等价于无回执
      if (/could not be found|not found|not exist|may not be processed/i.test(msg)) {
        return null;
      }
      this.logger.warn(`读取交易回执失败（tx=${txHash}）: ${msg}`);
      return 'rpc_error';
    }
  }

  private async tryReadRevertReason(
    chainId: number,
    txHash: string,
  ): Promise<string | null> {
    try {
      const client = this.rpc.getClient(chainId);
      const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
      if (!tx || !tx.to) {
        return null;
      }
      try {
        await client.call({
          to: tx.to,
          account: tx.from,
          data: tx.input,
          value: tx.value,
        });
        // 现在能成功执行 → 历史 revert 原因无法离线还原
        return null;
      } catch (callErr) {
        return this.extractRevertReason(callErr);
      }
    } catch (err) {
      this.logger.warn(`解析 revert 原因失败（tx=${txHash}）: ${this.errMsg(err)}`);
      return null;
    }
  }

  private extractRevertReason(err: unknown): string {
    const anyErr = err as {
      reason?: unknown;
      shortMessage?: unknown;
      message?: unknown;
      cause?: { reason?: unknown; data?: unknown };
    };
    const reason = anyErr?.cause?.reason ?? anyErr?.reason;
    if (typeof reason === 'string' && reason.length > 0) {
      return reason;
    }
    const short =
      typeof anyErr?.shortMessage === 'string'
        ? anyErr.shortMessage
        : typeof anyErr?.message === 'string'
          ? anyErr.message
          : '';
    const m = short.match(/reverted[:\s]*(.*)$/i);
    if (m && m[1] && m[1].trim().length > 0) {
      return m[1].trim();
    }
    const data = anyErr?.cause?.data;
    if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
      return `revert data=${data}`;
    }
    return short.length > 0 ? short : 'REVERTED';
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

  private toChainEventDto(
    e: SwapEvent,
    poolTokens: Map<string, { token0: string; token1: string }>,
  ): SwapChainEventDto {
    const ev = parseSwapEventData(e.event_data);
    const pt = poolTokens.get(ev.poolId);
    const dir = pt ? deriveSwapDirection(ev, pt.token0, pt.token1) : null;
    return {
      id: e.id,
      eventType: e.event_type,
      blockNumber: e.block_number,
      logIndex: e.log_index,
      pool: ev.pool || null,
      protocolType: ev.protocolType || null,
      family: ev.family,
      tokenIn: dir?.tokenIn ?? null,
      tokenOut: dir?.tokenOut ?? null,
      amountIn: dir?.amountIn ?? null,
      amountOut: dir?.amountOut ?? null,
      sender: ev.sender,
      recipient: ev.recipient,
    };
  }

  private async persistStatus(
    id: string,
    status: SwapStatus,
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

  /** 持久化链上回执的 failure_reason / gas / 区块高度（Analytics 失败原因 + 成本）。 */
  private async persistReceiptMeta(
    id: string,
    failureReason: string | null,
    gasUsed: string | null,
    effectiveGasPrice: string | null,
    blockNumber: number | null,
  ): Promise<void> {
    try {
      await this.prisma.swap.update({
        where: { id },
        data: {
          ...(failureReason ? { failure_reason: failureReason } : {}),
          ...(gasUsed !== null ? { gas_used: gasUsed } : {}),
          ...(effectiveGasPrice !== null
            ? { effective_gas_price: effectiveGasPrice }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`持久化回执元数据失败（id=${id}）: ${this.errMsg(err)}`);
    }
  }

  private async backfillEventSwapId(id: string, txHash: string): Promise<void> {
    try {
      await this.prisma.swapEvent.updateMany({
        where: { tx_hash: txHash, swap_id: null },
        data: { swap_id: id },
      });
    } catch (err) {
      this.logger.warn(`回填 swap_events.swap_id 失败（tx=${txHash}）: ${this.errMsg(err)}`);
    }
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  async getHistory(
    user: string,
    chainId?: number,
    page?: number,
    limit?: number,
  ): Promise<SwapHistoryResult> {
    const owner = this.assertAddress(user, 'user');
    const p = this.normalizePage(page);
    const l = this.normalizeLimit(limit);

    const where: Prisma.SwapWhereInput = { user_address: owner };
    if (chainId !== undefined) {
      this.assertChainId(chainId);
      where.chain_id = chainId;
    }

    const [total, rows] = await Promise.all([
      this.prisma.swap.count({ where }),
      this.prisma.swap.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
    ]);

    return { items: rows.map(toSwapDto), page: p, limit: l, total };
  }

  // ---------- 路径解析与报价 ----------

  /** 解析执行路径：显式 route > pathId（取最佳候选）> 直接单跳最优报价。 */
  private async resolvePath(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    req: PrepareSwapRequestDto,
  ): Promise<{ tokenPath: string[]; poolPath: string[]; protocolPath: string[] }> {
    if (req.route) {
      return this.validateRoute(req.route, tokenIn, tokenOut);
    }

    if (req.pathId) {
      const rows = await this.prisma.routeCandidate.findMany({
        where: { path_id: req.pathId },
        orderBy: { net_output: 'desc' },
      });
      if (rows.length === 0) {
        throw new NotFoundException(`路由不存在（pathId=${req.pathId}）`);
      }
      const best = rows[0];
      const tokenPath = this.parseJsonArray(best.token_path, 'token_path');
      const poolPath = this.parseJsonArray(best.pool_path, 'pool_path');
      const protocolPath = this.parseJsonArray(best.protocol_path, 'protocol_path');
      return this.validateRoute({ tokenPath, poolPath, protocolPath }, tokenIn, tokenOut);
    }

    const best = await this.poolService.quoteBestForChain(
      chainId,
      tokenIn,
      tokenOut,
      req.amountIn,
    );
    if (!best) {
      throw new HttpException(
        {
          code: ErrorCodes.NO_ROUTE,
          message: `未找到可用流动性池（${tokenIn} -> ${tokenOut}，chain=${chainId}）`,
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      tokenPath: [tokenIn, tokenOut],
      poolPath: [best.pool.address],
      protocolPath: [best.protocolType],
    };
  }

  private validateRoute(
    route: { tokenPath: string[]; poolPath: string[]; protocolPath: string[] },
    tokenIn: string,
    tokenOut: string,
  ): { tokenPath: string[]; poolPath: string[]; protocolPath: string[] } {
    const { tokenPath, poolPath, protocolPath } = route;
    if (
      !Array.isArray(tokenPath) ||
      !Array.isArray(poolPath) ||
      !Array.isArray(protocolPath)
    ) {
      throw new BadRequestException('route 的 tokenPath/poolPath/protocolPath 必须是数组');
    }
    if (tokenPath.length < 2) {
      throw new BadRequestException('route.tokenPath 至少需要 2 个 token');
    }
    if (poolPath.length !== tokenPath.length - 1 || protocolPath.length !== tokenPath.length - 1) {
      throw new BadRequestException(
        'route 长度不匹配：poolPath/protocolPath 长度必须等于 tokenPath 长度 - 1',
      );
    }
    if (tokenPath[0].toLowerCase() !== tokenIn || tokenPath[tokenPath.length - 1].toLowerCase() !== tokenOut) {
      throw new BadRequestException(
        `route.tokenPath 首尾与 tokenIn/tokenOut 不一致（首=${tokenPath[0]} 尾=${tokenPath[tokenPath.length - 1]}）`,
      );
    }
    const normPool = poolPath.map((p) => this.assertAddress(p, 'pool'));
    const normToken = tokenPath.map((t) => this.assertAddress(t, 'tokenPath'));
    const normProto = protocolPath.map((p) => {
      const v = String(p).toLowerCase();
      if (
        v !== AERODROME_PROTOCOL_TYPE_CLASSIC &&
        v !== AERODROME_PROTOCOL_TYPE_CL &&
        v !== UNISWAP_V3_PROTOCOL_TYPE
      ) {
        throw new BadRequestException(`不支持的 protocolPath 项: ${p}`);
      }
      return v;
    });
    return { tokenPath: normToken, poolPath: normPool, protocolPath: normProto };
  }

  /** 逐跳重新报价，返回 hops / 最终 amountOut / 组合价格影响 / 参考 gas。 */
  private async quotePath(
    chainId: number,
    tokenPath: string[],
    poolPath: string[],
    protocolPath: string[],
    amountIn: string,
  ): Promise<{
    hops: SwapHopDto[];
    amountOut: bigint;
    priceImpact: string;
    gasLimit: string;
  }> {
    const hops: SwapHopDto[] = [];
    const impacts: string[] = [];
    let gasSum = 0n;
    let amountInStr = amountIn;

    for (let i = 0; i < poolPath.length; i++) {
      const pool = poolPath[i];
      const protocol = protocolPath[i];
      const tIn = tokenPath[i];
      const tOut = tokenPath[i + 1];

      if (protocol === AERODROME_PROTOCOL_TYPE_CLASSIC) {
        const q = await this.classic.getQuote({
          chainId,
          poolAddress: pool,
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: amountInStr,
        });
        const stable = q.kind === 'classic-stable';
        gasSum += DEFAULT_SWAP_GAS_LIMIT;
        hops.push({
          pool,
          protocol,
          kind: q.kind,
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: amountInStr,
          amountOut: q.amountOut,
          fee: q.fee,
          stable,
        });
        impacts.push(q.priceImpact);
        amountInStr = q.amountOut;
      } else if (protocol === UNISWAP_V3_PROTOCOL_TYPE) {
        const q = await this.uniswapV3.getQuote({
          chainId,
          poolAddress: pool,
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: amountInStr,
        });
        gasSum += BigInt(q.gasEstimate ?? DEFAULT_SWAP_GAS_LIMIT.toString());
        hops.push({
          pool,
          protocol,
          kind: 'cl',
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: amountInStr,
          amountOut: q.amountOut,
          fee: q.fee,
        });
        impacts.push(q.priceImpact);
        amountInStr = q.amountOut;
      } else {
        const q = await this.cl.getQuote({
          chainId,
          poolAddress: pool,
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: amountInStr,
        });
        const state = await this.cl.getPoolState(pool);
        gasSum += BigInt(q.gasEstimate ?? DEFAULT_SWAP_GAS_LIMIT.toString());
        hops.push({
          pool,
          protocol,
          kind: 'cl',
          tokenIn: tIn,
          tokenOut: tOut,
          amountIn: amountInStr,
          amountOut: q.amountOut,
          fee: q.fee,
          tickSpacing: state.tickSpacing ?? 0,
        });
        impacts.push(q.priceImpact);
        amountInStr = q.amountOut;
      }
    }

    const last = hops[hops.length - 1];
    return {
      hops,
      amountOut: BigInt(last.amountOut),
      priceImpact: combinePriceImpacts(impacts),
      gasLimit: gasSum.toString(),
    };
  }

  /** 根据 hops 构造协议原生 Router calldata，返回目标合约 + 授权 spender + 协议。 */
  private buildTransaction(
    hops: SwapHopDto[],
    recipient: string,
    amountIn: string,
    amountOutMin: string,
    deadline: number,
    sqrtPriceLimitX96: string | undefined,
  ): { transaction: BuiltTransaction; spender: string; protocol: string } {
    const allClassic = hops.every((h) => h.protocol === AERODROME_PROTOCOL_TYPE_CLASSIC);
    const allCl = hops.every((h) => h.protocol === AERODROME_PROTOCOL_TYPE_CL);

    if (allClassic) {
      const routes = hops.map((h) =>
        classicRoute(h.tokenIn, h.tokenOut, h.stable ?? false),
      );
      const tx = buildClassicSwapExactTokensForTokens({
        amountIn,
        amountOutMin,
        routes,
        recipient,
        deadline,
      });
      return {
        transaction: tx,
        spender: AERODROME_CLASSIC_ROUTER.toLowerCase(),
        protocol: AERODROME_PROTOCOL_TYPE_CLASSIC,
      };
    }

    if (allCl) {
      if (hops.length === 1) {
        const h = hops[0];
        const tx = buildClExactInputSingle({
          tokenIn: h.tokenIn,
          tokenOut: h.tokenOut,
          tickSpacing: h.tickSpacing ?? 0,
          recipient,
          deadline,
          amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96,
        });
        return {
          transaction: tx,
          spender: AERODROME_SWAP_ROUTER.toLowerCase(),
          protocol: AERODROME_PROTOCOL_TYPE_CL,
        };
      }

      const path = encodeClPath(
        hops.map((h) => ({
          tokenIn: h.tokenIn,
          tokenOut: h.tokenOut,
          tickSpacing: h.tickSpacing ?? 0,
        })),
      );
      const tx = buildClExactInput({
        path,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: amountOutMin,
      });
      return {
        transaction: tx,
        spender: AERODROME_SWAP_ROUTER.toLowerCase(),
        protocol: AERODROME_PROTOCOL_TYPE_CL,
      };
    }

    const allUniswapV3 = hops.every(
      (h) => h.protocol === UNISWAP_V3_PROTOCOL_TYPE,
    );

    if (allUniswapV3) {
      if (hops.length === 1) {
        const h = hops[0];
        const tx = buildUniswapV3ExactInputSingle({
          tokenIn: h.tokenIn,
          tokenOut: h.tokenOut,
          fee: Number(h.fee),
          recipient,
          deadline,
          amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96,
        });
        return {
          transaction: tx,
          spender: UNISWAP_V3_SWAP_ROUTER.toLowerCase(),
          protocol: UNISWAP_V3_PROTOCOL_TYPE,
        };
      }

      const path = encodeUniswapV3Path(
        hops.map((h) => ({
          tokenIn: h.tokenIn,
          tokenOut: h.tokenOut,
          fee: Number(h.fee),
        })),
      );
      const tx = buildUniswapV3ExactInput({
        path,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: amountOutMin,
      });
      return {
        transaction: tx,
        spender: UNISWAP_V3_SWAP_ROUTER.toLowerCase(),
        protocol: UNISWAP_V3_PROTOCOL_TYPE,
      };
    }

    // classic + CL + Uniswap V3 混合多跳：单个原生 Router 无法承载，需 UniversalRouter 或自定义 Executor（后续 Sprint）。
    throw new HttpException(
      {
        code: ErrorCodes.UNSUPPORTED_ROUTE,
        message:
          '暂不支持 classic + CL 混合多跳执行（需 UniversalRouter 或自定义 Executor，属后续 Sprint）。' +
          '请拆成多条单跳，或将 maxPathLength 限制为单协议路径。',
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  // ---------- 链上读取 ----------

  private async readBalance(
    chainId: number,
    token: string,
    user: string,
  ): Promise<bigint> {
    try {
      return await this.erc20.readBalance(chainId, token, user);
    } catch (err) {
      throw this.toRpcException(err);
    }
  }

  private async readAllowance(
    chainId: number,
    token: string,
    user: string,
    spender: string,
  ): Promise<bigint> {
    try {
      return await this.erc20.readAllowance(chainId, token, user, spender);
    } catch (err) {
      throw this.toRpcException(err);
    }
  }

  // ---------- 校验与工具 ----------

  private resolveChainId(chainId?: number): number {
    if (chainId === undefined) {
      return BASE_MAINNET_CHAIN_ID;
    }
    this.assertChainId(chainId);
    return chainId;
  }

  private assertChainId(chainId: number): void {
    if (!isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
  }

  private assertAddress(address: string, label: string): string {
    if (!isValidAddress(address)) {
      throw new BadRequestException(`${label} 不是合法的 EVM 地址: ${address}`);
    }
    return normalizeAddress(address);
  }

  private assertTxHash(txHash: string): string {
    const raw = String(txHash ?? '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
      throw new BadRequestException(
        'txHash 必须是 0x 开头的 64 位十六进制交易哈希',
      );
    }
    return raw.toLowerCase();
  }

  private assertPositiveAmount(amount: string, label: string): string {
    const raw = String(amount ?? '').trim();
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException(`${label} 必须为正整数字符串（链上原始单位）`);
    }
    if (BigInt(raw) <= 0n) {
      throw new BadRequestException(`${label} 必须为正整数（链上原始单位）`);
    }
    return raw;
  }

  private normalizeSlippageBps(slippageBps?: number): number {
    const s = slippageBps ?? this.defaultSlippageBps();
    if (!Number.isInteger(s) || s < 0 || s > MAX_SLIPPAGE_BPS) {
      throw new BadRequestException(
        `slippageBps 必须是 0~${MAX_SLIPPAGE_BPS} 的整数（1 bps = 0.01%）`,
      );
    }
    return s;
  }

  private defaultSlippageBps(): number {
    const raw = Number(process.env.DEFAULT_SLIPPAGE_BPS ?? DEFAULT_SLIPPAGE_BPS);
    return Number.isInteger(raw) && raw >= 0 && raw <= MAX_SLIPPAGE_BPS
      ? raw
      : DEFAULT_SLIPPAGE_BPS;
  }

  private deadlineSeconds(): number {
    const raw = Number(
      process.env.SWAP_DEADLINE_SECONDS ?? DEFAULT_DEADLINE_SECONDS,
    );
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DEADLINE_SECONDS;
  }

  private normalizeSubmitStatus(status?: string): string {
    const s = status ?? SwapStatus.PENDING;
    if (!SUBMIT_ALLOWED_STATUSES.has(s)) {
      throw new BadRequestException(
        `submit 初始状态只能是 APPROVAL_REQUIRED / APPROVED / PENDING（收到 ${status}）`,
      );
    }
    return s;
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

  private parseJsonArray(json: string, label: string): string[] {
    try {
      const arr = JSON.parse(json);
      if (!Array.isArray(arr)) {
        throw new Error('not array');
      }
      return arr as string[];
    } catch {
      throw new HttpException(
        {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `存储的路由字段 ${label} 无法解析为数组`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private toRpcException(err: unknown): HttpException {
    const message =
      err instanceof ChainReadError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return new HttpException(
      { code: ErrorCodes.RPC_UNAVAILABLE, message },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
