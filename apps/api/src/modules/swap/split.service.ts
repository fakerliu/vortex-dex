import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DexPoolService, type PoolQuoteCandidate } from '../../dex/dex-pool.service';
import { AerodromeClassicAdapter } from '../../dex/aerodrome/aerodrome-classic.adapter';
import { AerodromeClAdapter } from '../../dex/aerodrome/aerodrome-cl.adapter';
import { UniswapV3Adapter } from '../../dex/uniswap-v3/uniswap-v3.adapter';
import {
  AERODROME_PROTOCOL_TYPE_CL,
  AERODROME_PROTOCOL_TYPE_CLASSIC,
} from '../../dex/aerodrome/constants';
import {
  UNISWAP_V3_CHAIN_ID,
  UNISWAP_V3_PROTOCOL_TYPE,
} from '../../dex/uniswap-v3/constants';
import type { QuoteResult } from '../../dex/types';
import { parseDecimal } from '../../dex/math';
import { buildApproveCalldata } from '../../dex/calldata';
import { formatUnits } from '../../common/utils/units';
import { ErrorCodes } from '../../common/constants/error-codes';
import {
  BASE_MAINNET_CHAIN_ID,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { getCatalogEntry } from '../../chain/token-catalog';
import { SwapService } from './swap.service';
import { MarketService } from '../market/market.service';
import {
  SplitChildStatus,
  SplitOrderStatus,
  type SplitApprovalDto,
  type SplitChildPrepareDto,
  type SplitOrderDetailDto,
  type SplitPrepareRequestDto,
  type SplitPrepareResponseDto,
  type SubmitSplitChildRequestDto,
  type SubmitSplitChildResponseDto,
} from './split.types';

/** 定点小数精度（与 dex/math parseDecimal / formatUnits 一致）。 */
const SCALE = 18n;
const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 10_000;
/** 二分逼近最大迭代次数（2^100 覆盖任意合理链上金额）。 */
const MAX_BINARY_ITERATIONS = 100;

/** 分配结果（供逐子单调 prepare）。 */
interface Allocation {
  candidate: PoolQuoteCandidate;
  amountIn: bigint;
}

/**
 * 拆单路由服务（V1.1-3 Split Order Routing）。
 *
 * - prepareSplit：拿全量候选 → 判触发 → 金额分配（贪心 + 二分，纯 BigInt）
 *   → 逐子单调 prepare → 按 spender 聚合授权 → 落库 SplitOrder + SplitChild。
 * - submitChild：广播成功后回写 Swap 记录 + 回填 split_children.swap_id + 更新母单状态。
 * - getSplitOrder：母单详情 + 子单进度。
 *
 * 复用边界：执行层复用 SwapService.prepare(显式单跳 route)；报价入口复用
 * DexPoolService.discoverPools/quotePair（多候选 + 各自 priceImpact）。
 */
@Injectable()
export class SplitService {
  private readonly logger = new Logger(SplitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly poolService: DexPoolService,
    private readonly swapService: SwapService,
    private readonly market: MarketService,
    private readonly classic: AerodromeClassicAdapter,
    private readonly cl: AerodromeClAdapter,
    private readonly uniswapV3: UniswapV3Adapter,
  ) {}

  // ---------- prepare ----------

  async prepareSplit(
    req: SplitPrepareRequestDto,
  ): Promise<SplitPrepareResponseDto> {
    const chainId = this.resolveChainId(req.chainId);
    const tokenIn = this.assertAddress(req.tokenIn, 'tokenIn');
    const tokenOut = this.assertAddress(req.tokenOut, 'tokenOut');
    const user = this.assertAddress(req.userAddress, 'userAddress');
    if (tokenIn === tokenOut) {
      throw new BadRequestException('tokenIn 与 tokenOut 不能相同');
    }
    const amountIn = this.assertPositiveAmount(req.amountIn, 'amountIn');
    const slippageBps = this.normalizeSlippageBps(req.slippageBps);
    const maxSplits = this.normalizeMaxSplits(req.maxSplits);
    // 阈值：请求体覆盖优先，否则读 env 默认；校验为正十进制数。
    const minUsd = this.resolveDecimalParam(
      req.minAmountUsd,
      this.splitMinAmountUsd(),
      'minAmountUsd',
    );
    const threshold = this.resolveDecimalParam(
      req.priceImpactThreshold,
      this.splitPriceImpactThreshold(),
      'priceImpactThreshold',
    );

    // 1. 拿全量候选（各自含独立 priceImpact 与 amountOut）
    const candidates = await this.discoverCandidates(
      chainId,
      tokenIn,
      tokenOut,
      req.amountIn,
    );
    if (candidates.length === 0) {
      throw new HttpException(
        {
          code: ErrorCodes.NO_ROUTE,
          message: `未找到可用流动性池（${tokenIn} -> ${tokenOut}，chain=${chainId}）`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // 2. 判定是否拆分
    const best = this.bestCandidate(candidates);
    const bestImpact = parseDecimal(best.quote.priceImpact, SCALE);
    const bestImpactExceeds = bestImpact >= parseDecimal(threshold, SCALE);
    const amountMeetsUsd = await this.amountMeetsUsdThreshold(
      chainId,
      tokenIn,
      amountIn,
      minUsd,
    );

    const notes: string[] = [];
    let allocations: Allocation[];
    let shouldSplit = false;

    if (candidates.length <= 1) {
      notes.push('候选池不足（<=1），未拆分，已回退为单路径执行');
    } else if (!bestImpactExceeds) {
      notes.push(
        `最优单路径价格影响 ${best.quote.priceImpact} 未达阈值 ${threshold}，未拆分，已回退为单路径执行`,
      );
    } else if (!amountMeetsUsd) {
      notes.push(`金额未达 USD 阈值，未拆分，已回退为单路径执行`);
    } else {
      shouldSplit = true;
    }

    if (shouldSplit) {
      allocations = await this.allocate(
        chainId,
        tokenIn,
        tokenOut,
        amountIn,
        candidates,
        threshold,
        maxSplits,
        notes,
      );
    } else {
      allocations = [{ candidate: best, amountIn }];
    }

    // 3. 逐子单构造执行（显式单跳 route，取回权威 amountOut / priceImpact）
    const children: SplitChildPrepareDto[] = [];
    const approvalMap = new Map<
      string,
      { spender: string; amount: bigint; allowance: bigint }
    >();

    for (let i = 0; i < allocations.length; i++) {
      const alloc = allocations[i];
      const prepared = await this.swapService.prepare({
        chainId,
        userAddress: user,
        tokenIn,
        tokenOut,
        amountIn: alloc.amountIn.toString(),
        slippageBps,
        route: {
          tokenPath: [tokenIn, tokenOut],
          poolPath: [alloc.candidate.pool.address],
          protocolPath: [alloc.candidate.protocolType],
        },
      });

      children.push({
        index: i + 1,
        poolAddress: alloc.candidate.pool.address,
        protocolType: alloc.candidate.protocolType,
        amountIn: prepared.amountIn,
        amountOut: prepared.amountOut,
        priceImpact: prepared.priceImpact,
        minimumReceived: prepared.minimumReceived,
        deadline: prepared.deadline,
        spender: prepared.spender,
        transaction: prepared.transaction,
      });

      const entry = approvalMap.get(prepared.spender) ?? {
        spender: prepared.spender,
        amount: 0n,
        allowance: BigInt(prepared.allowance),
      };
      entry.amount += BigInt(prepared.amountIn);
      approvalMap.set(prepared.spender, entry);
    }

    if (shouldSplit) {
      notes.push(`已拆分为 ${children.length} 条子单`);
    }

    // 4. 聚合授权（按 spender 分组，同组 amountIn 求和）
    const approvals: SplitApprovalDto[] = [];
    for (const entry of approvalMap.values()) {
      const amount = entry.amount.toString();
      const needed = entry.allowance < entry.amount;
      const approveTx = buildApproveCalldata({ spender: entry.spender, amount });
      approvals.push({
        token: tokenIn,
        spender: entry.spender,
        amount,
        needed,
        data: approveTx.data,
        functionName: approveTx.functionName,
        selector: approveTx.selector,
      });
    }

    // 5. 聚合整体价格影响（按 amountIn 加权）
    const amountOutTotal = children.reduce(
      (sum, c) => sum + BigInt(c.amountOut),
      0n,
    );
    const priceImpactAggregated = this.aggregatePriceImpact(children);

    // 6. 落库：母单 + N 子单（swap_id 暂空）
    const order = await this.prisma.splitOrder.create({
      data: {
        user_address: user,
        chain_id: chainId,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: new Prisma.Decimal(amountIn.toString()),
        status: SplitOrderStatus.PENDING,
        child_count: children.length,
        ...(req.intentId ? { intent_id: req.intentId } : {}),
      },
    });

    await this.prisma.splitChild.createMany({
      data: children.map((c) => ({
        split_order_id: order.id,
        pool_address: c.poolAddress,
        protocol_type: c.protocolType,
        amount_in: new Prisma.Decimal(c.amountIn),
        amount_out: new Prisma.Decimal(c.amountOut),
        price_impact: new Prisma.Decimal(c.priceImpact),
        order_index: c.index,
        status: SplitChildStatus.PENDING,
      })),
    });

    return {
      splitOrderId: order.id,
      chainId,
      userAddress: user,
      tokenIn,
      tokenOut,
      amountIn: req.amountIn,
      amountOutTotal: amountOutTotal.toString(),
      priceImpactAggregated,
      splits: children,
      approvals,
      quoteTimestamp: new Date().toISOString(),
      notes,
    };
  }

  // ---------- submit-child / query ----------

  async submitChild(
    splitOrderId: string,
    req: SubmitSplitChildRequestDto,
  ): Promise<SubmitSplitChildResponseDto> {
    const order = await this.prisma.splitOrder.findUnique({
      where: { id: splitOrderId },
      include: { children: { orderBy: { order_index: 'asc' } } },
    });
    if (!order) {
      throw new NotFoundException(`拆单母单不存在（id=${splitOrderId}）`);
    }

    const child = order.children.find(
      (c) => c.order_index === req.childIndex,
    );
    if (!child) {
      throw new NotFoundException(`子单不存在（index=${req.childIndex}）`);
    }
    if (child.status !== SplitChildStatus.PENDING) {
      throw new BadRequestException(
        `子单状态不是 pending（当前 ${child.status}）`,
      );
    }

    const amountOut = this.assertPositiveAmount(req.amountOut, 'amountOut');

    // 复用 swap.service.submit 写库（含用户 upsert + tx_hash 去重 + Analytics）
    const swap = await this.swapService.submit({
      txHash: req.txHash,
      userAddress: order.user_address,
      tokenIn: order.token_in,
      tokenOut: order.token_out,
      amountIn: child.amount_in.toString(),
      amountOut: amountOut.toString(),
      chainId: order.chain_id,
      ...(order.intent_id ? { intentId: order.intent_id } : {}),
    });

    // 读链上回执判定实际状态：revert → FAILED；成功/未上链 → 乐观 CONFIRMED。
    // swap 表状态由 swap 模块自己管，这里只负责 split_children.status。
    let childStatus: SplitChildStatus = SplitChildStatus.CONFIRMED;
    const receipt = await this.swapService.tryReadReceipt(
      order.chain_id,
      req.txHash,
    );
    if (receipt === 'rpc_error') {
      this.logger.warn(
        `读取子单回执失败（rpc_error），保持 CONFIRMED 乐观状态（child=${child.id}，tx=${req.txHash}）`,
      );
    } else if (receipt) {
      if (receipt.status === 'success') {
        childStatus = SplitChildStatus.CONFIRMED;
      } else {
        childStatus = SplitChildStatus.FAILED;
        this.logger.warn(
          `子单链上 revert，置为 FAILED（child=${child.id}，tx=${req.txHash}）`,
        );
      }
    }

    await this.prisma.splitChild.update({
      where: { id: child.id },
      data: { swap_id: swap.id, status: childStatus },
    });

    const status = await this.recomputeOrderStatus(order.id);

    return {
      splitOrderId: order.id,
      childIndex: req.childIndex,
      swapId: swap.id,
      status,
    };
  }

  async getSplitOrder(splitOrderId: string): Promise<SplitOrderDetailDto> {
    const order = await this.prisma.splitOrder.findUnique({
      where: { id: splitOrderId },
      include: {
        children: {
          orderBy: { order_index: 'asc' },
          include: { swap: true },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`拆单母单不存在（id=${splitOrderId}）`);
    }
    return {
      splitOrderId: order.id,
      status: order.status as SplitOrderStatus,
      childCount: order.child_count,
      amountIn: order.amount_in.toString(),
      tokenIn: order.token_in,
      tokenOut: order.token_out,
      chainId: order.chain_id,
      children: order.children.map((c) => ({
        index: c.order_index,
        poolAddress: c.pool_address,
        protocolType: c.protocol_type,
        amountIn: c.amount_in.toString(),
        amountOut: c.amount_out.toString(),
        status: c.status as SplitChildStatus,
        swapId: c.swap_id,
        txHash: c.swap?.tx_hash ?? null,
      })),
    };
  }

  async cancelSplitOrder(splitOrderId: string): Promise<SplitOrderDetailDto> {
    const order = await this.prisma.splitOrder.findUnique({
      where: { id: splitOrderId },
      include: { children: true },
    });
    if (!order) {
      throw new NotFoundException(`拆单母单不存在（id=${splitOrderId}）`);
    }
    if (
      order.status === SplitOrderStatus.COMPLETED ||
      order.status === SplitOrderStatus.FAILED ||
      order.status === SplitOrderStatus.CANCELLED
    ) {
      throw new BadRequestException('母单已终态，无法取消');
    }

    // 已 confirmed 子单保持（已上链不可撤回）；仅 pending 子单置 failed。
    const pendingIds = order.children
      .filter((c) => c.status === SplitChildStatus.PENDING)
      .map((c) => c.id);
    if (pendingIds.length > 0) {
      await this.prisma.splitChild.updateMany({
        where: { id: { in: pendingIds } },
        data: { status: SplitChildStatus.FAILED },
      });
    }

    await this.prisma.splitOrder.update({
      where: { id: splitOrderId },
      data: { status: SplitOrderStatus.CANCELLED },
    });

    return this.getSplitOrder(splitOrderId);
  }

  // ---------- 候选发现与报价 ----------

  /** 按链分派，拿全量候选（84532 走 Uniswap V3，其余走 Aerodrome classic + CL）。 */
  private async discoverCandidates(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
  ): Promise<PoolQuoteCandidate[]> {
    if (chainId === UNISWAP_V3_CHAIN_ID) {
      const pools = await this.poolService.discoverUniswapV3Pools(tokenIn, tokenOut);
      if (pools.length === 0) {
        return [];
      }
      return this.poolService.quoteUniswapV3Pair(
        chainId,
        tokenIn,
        tokenOut,
        amountIn,
        pools,
      );
    }

    const { classicPools, clPools } = await this.poolService.discoverPools(
      tokenIn,
      tokenOut,
    );
    if (classicPools.length === 0 && clPools.length === 0) {
      return [];
    }
    return this.poolService.quotePair(
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      classicPools,
      clPools,
    );
  }

  /** 对单个候选池以指定金额重新报价（供二分逼近阈值）。 */
  private async quoteCandidateAt(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    candidate: PoolQuoteCandidate,
    amountIn: string,
  ): Promise<QuoteResult> {
    const params = {
      chainId,
      poolAddress: candidate.pool.address,
      tokenIn,
      tokenOut,
      amountIn,
    };
    switch (candidate.protocolType) {
      case AERODROME_PROTOCOL_TYPE_CLASSIC:
        return this.classic.getQuote(params);
      case AERODROME_PROTOCOL_TYPE_CL:
        return this.cl.getQuote(params);
      case UNISWAP_V3_PROTOCOL_TYPE:
        return this.uniswapV3.getQuote(params);
      default:
        throw new Error(`未知协议类型: ${candidate.protocolType}`);
    }
  }

  private bestCandidate(
    candidates: PoolQuoteCandidate[],
  ): PoolQuoteCandidate {
    return candidates.reduce((a, b) =>
      BigInt(a.quote.amountOut) >= BigInt(b.quote.amountOut) ? a : b,
    );
  }

  // ---------- 拆分算法 ----------

  /**
   * 贪心 + 二分金额分配：
   * 按 amountOut 效率（全量报价 amountOut）降序，逐池二分求「不超阈值最大可承接金额」，
   * 贪心填充；剩余金额由最后一池承接（priceImpact 可能超标）。
   */
  private async allocate(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    totalAmountIn: bigint,
    candidates: PoolQuoteCandidate[],
    threshold: string,
    maxSplits: number,
    notes: string[],
  ): Promise<Allocation[]> {
    const sorted = [...candidates].sort((a, b) => {
      const da = BigInt(a.quote.amountOut);
      const db = BigInt(b.quote.amountOut);
      return da < db ? 1 : da > db ? -1 : 0;
    });

    const allocations: Allocation[] = [];
    let remaining = totalAmountIn;

    for (let i = 0; i < sorted.length && allocations.length < maxSplits && remaining > 0n; i++) {
      const candidate = sorted[i];
      const cap = await this.binarySearchCap(
        chainId,
        tokenIn,
        tokenOut,
        candidate,
        threshold,
        totalAmountIn,
      );
      if (cap <= 0n) {
        continue;
      }
      const take = cap >= remaining ? remaining : cap;
      allocations.push({ candidate, amountIn: take });
      remaining -= take;
    }

    if (remaining > 0n) {
      if (allocations.length === 0) {
        // 所有池在阈值内均无法承接：整笔走最优池，如实标注
        const best = sorted[0];
        allocations.push({ candidate: best, amountIn: totalAmountIn });
        notes.push(
          `所有候选池在价格影响阈值（${threshold}）内均无法承接，已回退为单池整笔执行`,
        );
      } else {
        // 流动性不足：最后一池承接剩余金额
        const last = allocations[allocations.length - 1];
        last.amountIn += remaining;
        notes.push(
          `流动性不足：最后一池承接剩余金额，其价格影响可能超过阈值（${threshold}）`,
        );
      }
    }

    return allocations;
  }

  /** 二分逼近「某池不超 priceImpact 阈值前提下的最大可承接金额」。 */
  private async binarySearchCap(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    candidate: PoolQuoteCandidate,
    threshold: string,
    upperBound: bigint,
  ): Promise<bigint> {
    const thr = parseDecimal(threshold, SCALE);
    let lo = 0n;
    let hi = upperBound;
    let best = 0n;
    let iter = 0;

    while (lo <= hi && iter < MAX_BINARY_ITERATIONS) {
      const mid = (lo + hi) / 2n;
      iter += 1;
      if (mid === 0n) {
        lo = 1n;
        continue;
      }
      let priceImpact: string;
      try {
        const q = await this.quoteCandidateAt(
          chainId,
          tokenIn,
          tokenOut,
          candidate,
          mid.toString(),
        );
        priceImpact = q.priceImpact;
      } catch (err) {
        // 探测金额超出池流动性时合约 getAmountOut revert（ChainReadError）。
        // 视为「该 mid 不可行，priceImpact 必然超标」→ 收缩上界往小找，不冒泡成 500。
        this.logger.warn(
          `二分探测报价失败（pool=${candidate.pool.address}，amount=${mid}）: ${this.errMsg(err)}`,
        );
        hi = mid - 1n;
        continue;
      }
      if (parseDecimal(priceImpact, SCALE) <= thr) {
        best = mid;
        lo = mid + 1n;
      } else {
        hi = mid - 1n;
      }
    }
    return best;
  }

  /** 拆分后整体价格影响：按各子单 amountIn 加权平均（纯 BigInt 定点）。 */
  private aggregatePriceImpact(
    children: { amountIn: string; priceImpact: string }[],
  ): string {
    let totalIn = 0n;
    let weighted = 0n;
    for (const c of children) {
      const amt = BigInt(c.amountIn);
      const impact = parseDecimal(c.priceImpact, SCALE);
      totalIn += amt;
      weighted += amt * impact;
    }
    if (totalIn === 0n) {
      return '0';
    }
    return formatUnits((weighted / totalIn).toString(), Number(SCALE));
  }

  // ---------- 母单状态机 ----------

  private async recomputeOrderStatus(
    splitOrderId: string,
  ): Promise<SplitOrderStatus> {
    const children = await this.prisma.splitChild.findMany({
      where: { split_order_id: splitOrderId },
      select: { status: true },
    });
    const status = this.computeOrderStatus(children.map((c) => c.status));
    await this.prisma.splitOrder.update({
      where: { id: splitOrderId },
      data: { status },
    });
    return status;
  }

  private computeOrderStatus(childStatuses: string[]): SplitOrderStatus {
    if (childStatuses.length === 0) {
      return SplitOrderStatus.PENDING;
    }
    if (childStatuses.every((s) => s === SplitChildStatus.CONFIRMED)) {
      return SplitOrderStatus.COMPLETED;
    }
    if (childStatuses.every((s) => s === SplitChildStatus.FAILED)) {
      return SplitOrderStatus.FAILED;
    }
    return childStatuses.some((s) => s !== SplitChildStatus.PENDING)
      ? SplitOrderStatus.PARTIAL
      : SplitOrderStatus.PENDING;
  }

  // ---------- USD 阈值换算 ----------

  /** amountIn 换算 USD 是否 ≥ minUsd；换算失败跳过金额条件（返回 true）。 */
  private async amountMeetsUsdThreshold(
    chainId: number,
    tokenIn: string,
    amountIn: bigint,
    minUsd: string,
  ): Promise<boolean> {
    let priceUsd: string | null = null;
    try {
      priceUsd = (await this.market.getTokenPrice(chainId, tokenIn)).priceUsd;
    } catch (err) {
      this.logger.warn(`USD 换算失败（${tokenIn}）: ${this.errMsg(err)}`);
    }
    if (priceUsd === null) {
      return true;
    }
    const decimals = await this.resolveDecimals(chainId, tokenIn);
    const priceFixed = parseDecimal(priceUsd, SCALE);
    const amountUsdFixed = (amountIn * priceFixed) / 10n ** BigInt(decimals);
    return amountUsdFixed >= parseDecimal(minUsd, SCALE);
  }

  private async resolveDecimals(chainId: number, address: string): Promise<number> {
    const entry = getCatalogEntry(chainId, address);
    if (entry) {
      return entry.decimals;
    }
    try {
      const row = await this.prisma.token.findUnique({
        where: { chain_id_address: { chain_id: chainId, address } },
        select: { decimals: true },
      });
      if (row) {
        return row.decimals;
      }
    } catch {
      // DB 不可达仅影响 decimals 精度，兜底 18
    }
    return 18;
  }

  // ---------- 校验与配置 ----------

  private resolveChainId(chainId?: number): number {
    if (chainId === undefined) {
      return BASE_MAINNET_CHAIN_ID;
    }
    if (!isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
    return chainId;
  }

  private assertAddress(address: string, label: string): string {
    if (!isValidAddress(address)) {
      throw new BadRequestException(`${label} 不是合法的 EVM 地址: ${address}`);
    }
    return normalizeAddress(address);
  }

  private assertPositiveAmount(amount: string, label: string): bigint {
    const raw = String(amount ?? '').trim();
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException(
        `${label} 必须为正整数字符串（链上原始单位）`,
      );
    }
    const v = BigInt(raw);
    if (v <= 0n) {
      throw new BadRequestException(`${label} 必须为正整数（链上原始单位）`);
    }
    return v;
  }

  private normalizeSlippageBps(slippageBps?: number): number {
    const s = slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    if (!Number.isInteger(s) || s < 0 || s > MAX_SLIPPAGE_BPS) {
      throw new BadRequestException(
        `slippageBps 必须是 0~${MAX_SLIPPAGE_BPS} 的整数（1 bps = 0.01%）`,
      );
    }
    return s;
  }

  private normalizeMaxSplits(maxSplits?: number): number {
    const v = maxSplits ?? this.splitMaxChildren();
    if (!Number.isInteger(v) || v < 1) {
      throw new BadRequestException('maxSplits 必须是 >= 1 的整数');
    }
    return v;
  }

  private splitMinAmountUsd(): string {
    const raw = (process.env.SPLIT_MIN_AMOUNT_USD ?? '100000').trim();
    return raw.length > 0 ? raw : '100000';
  }

  private splitPriceImpactThreshold(): string {
    const raw = (process.env.SPLIT_PRICE_IMPACT_THRESHOLD ?? '0.01').trim();
    return raw.length > 0 ? raw : '0.01';
  }

  /** 解析阈值参数：请求覆盖优先，否则用 env 默认；校验为合法正十进制数。 */
  private resolveDecimalParam(
    override: string | undefined,
    fallback: string,
    label: string,
  ): string {
    const raw = override !== undefined ? String(override).trim() : '';
    const value = raw.length > 0 ? raw : fallback;
    if (!/^\d+(\.\d+)?$/.test(value) || parseDecimal(value, SCALE) <= 0n) {
      throw new BadRequestException(
        `${label} 必须是正十进制数（如 "0.01" 或 "100000"）`,
      );
    }
    return value;
  }

  private splitMaxChildren(): number {
    const raw = Number(process.env.SPLIT_MAX_CHILDREN ?? '5');
    return Number.isInteger(raw) && raw >= 1 ? raw : 5;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
