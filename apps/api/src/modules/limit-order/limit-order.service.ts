import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LimitOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChainRpcService } from '../../chain/chain-rpc.service';
import {
  buildExplorerTxUrl,
  isSupportedChainId,
} from '../../chain/chain.constants';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { getCatalogEntry } from '../../chain/token-catalog';
import { parseDecimal } from '../../dex/math';
import { SwapService } from '../swap/swap.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher';
import {
  buildSwapTransaction,
  deriveMinAmountOut,
  verifySignedApproval,
  verifySignedSwap,
} from './limit-order.signer';
import {
  LimitOrderStatus,
  decimalToString,
  type CreateLimitOrderRequestDto,
  type CreateLimitOrderResponseDto,
  type LimitOrderDirection,
  type LimitOrderDto,
  type LimitOrderListQueryDto,
  type LimitOrderListResultDto,
  type SubmitSignatureRequestDto,
} from './limit-order.types';

const DEFAULT_CHAIN_ID = 8453;
const PRICE_SCALE = 18n;
const DEFAULT_LIMIT_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 最长 7 天上界（架构 §5.3）
const DEFAULT_APPROVAL_GAS_LIMIT = '50000'; // ERC20 approve 参考 gas
const DEFAULT_MAX_FEE_PER_GAS = 1_000_000_000n; // 1 gwei（RPC 估算失败兜底）
const DEFAULT_MAX_PRIORITY_FEE_PER_GAS = 100_000_000n; // 0.1 gwei（RPC 估算失败兜底）
const DEFAULT_GAS_FEE_BUMP_PCT = 120; // 按当前价上浮 20%（架构 §5.3 gas 固化缓解）
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** 正十进制字符串（允许整数或小数，如 "0.0004" / "2500"）。 */
const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** 合法状态取值。 */
const LIMIT_ORDER_STATUSES: string[] = [
  LimitOrderStatus.PENDING,
  LimitOrderStatus.TRIGGERED,
  LimitOrderStatus.FILLED,
  LimitOrderStatus.CANCELLED,
  LimitOrderStatus.EXPIRED,
  LimitOrderStatus.FAILED,
];

/**
 * 限价单核心服务（V1.4 Phase 1）。
 *
 * - createOrder：下单（派生 min_amount_out + 复用 SwapService.prepare 构造待签交易）。
 * - submitSignature：校验预签交易并武装订单。
 * - listOrders / getOrder / cancelOrder：查询 + 撤单（CAS + 属主校验）。
 */
@Injectable()
export class LimitOrderService {
  private readonly logger = new Logger(LimitOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly swapService: SwapService,
    private readonly rpc: ChainRpcService,
    private readonly notificationDispatcher: NotificationDispatcher,
  ) {}

  // ---------- 下单 ----------

  async createOrder(
    req: CreateLimitOrderRequestDto,
  ): Promise<CreateLimitOrderResponseDto> {
    const chainId = this.resolveChainId(req.chainId);
    const user = this.assertAddress(req.userAddress, 'userAddress');
    const tokenIn = this.assertAddress(req.tokenIn, 'tokenIn');
    const tokenOut = this.assertAddress(req.tokenOut, 'tokenOut');
    if (tokenIn === tokenOut) {
      throw new BadRequestException('tokenIn 与 tokenOut 不能相同');
    }
    const amountIn = this.assertPositiveAmount(req.amountIn, 'amountIn');
    const limitPrice = this.assertLimitPrice(req.limitPrice);
    const direction = this.assertDirection(req.direction);
    const slippageBps = this.normalizeSlippageBps(req.slippageBps);
    const expiresAt = this.resolveExpiresAt(req.expiresAt);

    // 派生权威限价 min_amount_out（BigInt floor，禁 Float，架构 §3.3）。
    const minAmountOut = deriveMinAmountOut(
      BigInt(amountIn),
      limitPrice,
      this.resolveDecimals(chainId, tokenIn),
      this.resolveDecimals(chainId, tokenOut),
    );

    // 复用 SwapService.prepare：解析路由 + 查余额/allowance + 构造 approve calldata。
    // prepare 的 swap calldata 里 amountOutMin=滑点值、deadline=now+短时，此处不采用，
    // 只复用其 route（hops）与 approval / 余额 / allowance。
    const prepared = await this.swapService.prepare({
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      userAddress: user,
      slippageBps: 0,
    });

    // 以限价单语义重建 swap calldata：amountOutMin = min_amount_out，deadline = expires_at，recipient = user。
    const deadline = Math.floor(expiresAt.getTime() / 1000);
    const swapTx = buildSwapTransaction(
      prepared.route,
      user,
      amountIn,
      minAmountOut.toString(),
      deadline,
    );

    // 补 nonce（pending 计数）与 EIP-1559 gas 费。
    const baseNonce = await this.readPendingNonce(chainId, user);
    const fees = await this.estimateFees(chainId);

    const transactions: CreateLimitOrderResponseDto['signingPayload']['transactions'] =
      [];
    if (prepared.needsApproval) {
      transactions.push({
        kind: 'approve',
        to: tokenIn,
        value: '0',
        data: prepared.approval!.data,
        nonce: baseNonce,
        gasLimit: DEFAULT_APPROVAL_GAS_LIMIT,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    }
    transactions.push({
      kind: 'swap',
      to: swapTx.to,
      value: swapTx.value,
      data: swapTx.data,
      nonce: baseNonce + (prepared.needsApproval ? 1 : 0),
      gasLimit: prepared.transaction.gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });

    // 落库（pending + 未武装）。
    await this.prisma.user.upsert({
      where: { wallet_address: user },
      update: {},
      create: { wallet_address: user },
    });
    const row = await this.prisma.limitOrder.create({
      data: {
        user_address: user,
        chain_id: chainId,
        direction,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: this.dec(amountIn),
        min_amount_out: this.dec(minAmountOut.toString()),
        limit_price: new Prisma.Decimal(limitPrice),
        slippage_bps: slippageBps,
        status: LimitOrderStatus.PENDING,
        expires_at: expiresAt,
      },
    });

    return {
      order: this.toDto(row),
      signingPayload: { chainId, transactions },
    };
  }

  // ---------- 提交签名（武装订单） ----------

  async submitSignature(
    id: string,
    req: SubmitSignatureRequestDto,
  ): Promise<LimitOrderDto> {
    const user = this.assertAddress(req.userAddress, 'userAddress');
    const order = await this.prisma.limitOrder.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException(`限价单不存在（id=${id}）`);
    }
    if (order.user_address !== user) {
      throw new ForbiddenException('无权提交该订单的签名');
    }
    if (order.status !== LimitOrderStatus.PENDING) {
      throw new ConflictException(
        `订单状态 ${order.status} 不可提交签名（仅 pending）`,
      );
    }
    if (order.signed_swap_tx) {
      throw new ConflictException('订单已武装（已提交签名）');
    }
    if (!req.signedSwapTx || typeof req.signedSwapTx !== 'string') {
      throw new BadRequestException('signedSwapTx 必填');
    }

    // 校验签名交易（recover + calldata 比对），非本人/内容不符直接抛错不落库。
    await verifySignedSwap(req.signedSwapTx, {
      chainId: order.chain_id,
      userAddress: order.user_address,
      amountIn: order.amount_in.toString(),
      minAmountOut: order.min_amount_out.toString(),
      expiresAt: order.expires_at!,
    });

    let signedApprovalTx: string | null = null;
    if (req.signedApprovalTx) {
      await verifySignedApproval(req.signedApprovalTx, {
        chainId: order.chain_id,
        userAddress: order.user_address,
        tokenIn: order.token_in,
        amountIn: order.amount_in.toString(),
      });
      signedApprovalTx = req.signedApprovalTx;
    }

    // CAS 抢占（防并发双提交）：仅当仍 pending 且未武装时才落签名。
    const updated = await this.prisma.limitOrder.updateMany({
      where: {
        id,
        user_address: user,
        status: LimitOrderStatus.PENDING,
        signed_swap_tx: null,
      },
      data: {
        signed_swap_tx: req.signedSwapTx,
        signed_approval_tx: signedApprovalTx,
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('订单已武装或状态不可提交签名');
    }

    const row = await this.prisma.limitOrder.findUnique({ where: { id } });
    return this.toDto(row!);
  }

  // ---------- 查询 ----------

  async listOrders(
    query: LimitOrderListQueryDto,
  ): Promise<LimitOrderListResultDto> {
    const user = this.assertAddress(query.user, 'user');
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);

    const where: Prisma.LimitOrderWhereInput = { user_address: user };
    if (query.status !== undefined) {
      where.status = this.assertStatus(query.status);
    }

    const [total, rows] = await Promise.all([
      this.prisma.limitOrder.count({ where }),
      this.prisma.limitOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: rows.map((r) => this.toDto(r)), page, limit, total };
  }

  async getOrder(id: string): Promise<LimitOrderDto> {
    const row = await this.prisma.limitOrder.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`限价单不存在（id=${id}）`);
    }
    return this.toDto(row);
  }

  // ---------- 撤单 ----------

  async cancelOrder(id: string, userAddress: string): Promise<LimitOrderDto> {
    const user = this.assertAddress(userAddress, 'userAddress');

    // CAS + 属主校验：仅 pending 可撤。
    const res = await this.prisma.limitOrder.updateMany({
      where: { id, user_address: user, status: LimitOrderStatus.PENDING },
      data: { status: LimitOrderStatus.CANCELLED },
    });
    if (res.count === 0) {
      const existing = await this.prisma.limitOrder.findUnique({ where: { id } });
      if (!existing || existing.user_address !== user) {
        throw new NotFoundException(`限价单不存在（id=${id}）`);
      }
      throw new ConflictException(
        `订单状态 ${existing.status} 不可撤单（仅 pending）`,
      );
    }

    const row = await this.prisma.limitOrder.findUnique({ where: { id } });
    await this.notify(row!, 'limit_order_cancelled', '限价单已撤单');
    return this.toDto(row!);
  }

  // ---------- 供 keeper 复用的状态回写 ----------

  /** 触发 CAS：pending -> triggered（影响行数===1 才抢到，架构 §七）。 */
  async claimTriggered(id: string): Promise<boolean> {
    const res = await this.prisma.limitOrder.updateMany({
      where: { id, status: LimitOrderStatus.PENDING },
      data: { status: LimitOrderStatus.TRIGGERED, triggered_at: new Date() },
    });
    return res.count === 1;
  }

  /** 记录广播 txHash（triggered 中间态），供崩溃后对账。 */
  async recordTxHash(id: string, txHash: string): Promise<void> {
    await this.prisma.limitOrder.update({
      where: { id },
      data: { tx_hash: txHash.toLowerCase() },
    });
  }

  /** 成交回填：triggered -> filled + 落 swaps + swap_id + tx_hash + filled_at。 */
  async markFilled(
    order: LimitOrder,
    txHash: string,
    amountOut: string,
  ): Promise<void> {
    const tx = txHash.toLowerCase();
    try {
      const swap = await this.prisma.swap.create({
        data: {
          user_address: order.user_address,
          token_in: order.token_in,
          token_out: order.token_out,
          amount_in: order.amount_in,
          amount_out: this.dec(amountOut),
          tx_hash: tx,
          status: 'CONFIRMED',
          chain_id: order.chain_id,
        },
      });
      await this.prisma.limitOrder.update({
        where: { id: order.id },
        data: {
          status: LimitOrderStatus.FILLED,
          filled_at: new Date(),
          tx_hash: tx,
          swap_id: swap.id,
        },
      });
    } catch (err) {
      // swaps.tx_hash 唯一约束：重复写库静默跳过（幂等第三道闸）。
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.warn(`成交回填重复（id=${order.id} tx=${tx}），跳过`);
      } else {
        this.logger.warn(`成交回填失败（id=${order.id}）: ${this.errMsg(err)}`);
      }
    }
    const row = await this.prisma.limitOrder.findUnique({ where: { id: order.id } });
    if (row) {
      await this.notify(row, 'limit_order_filled', '限价单已成交');
    }
  }

  /** 失败回写：triggered -> failed + failure_reason。 */
  async markFailed(order: LimitOrder, reason: string): Promise<void> {
    await this.prisma.limitOrder.updateMany({
      where: { id: order.id, status: LimitOrderStatus.TRIGGERED },
      data: { status: LimitOrderStatus.FAILED, failure_reason: reason },
    });
    const row = await this.prisma.limitOrder.findUnique({ where: { id: order.id } });
    if (row) {
      await this.notify(row, 'limit_order_failed', '限价单成交失败');
    }
  }

  // ---------- 通知 ----------

  async notify(order: LimitOrder, type: string, title: string): Promise<void> {
    try {
      await this.notificationDispatcher.dispatch('in_app', {
        userAddress: order.user_address,
        type,
        title,
        body: this.buildNotifyBody(order, type),
        tokenAddress: order.token_out,
      });
    } catch (err) {
      this.logger.warn(`落通知失败（order=${order.id}）: ${this.errMsg(err)}`);
    }
  }

  // ---------- DTO 转换 ----------

  toDto(row: LimitOrder): LimitOrderDto {
    return {
      id: row.id,
      userAddress: row.user_address,
      chainId: row.chain_id,
      direction: row.direction as LimitOrderDirection,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amountIn: row.amount_in.toString(),
      minAmountOut: row.min_amount_out.toString(),
      limitPrice: decimalToString(row.limit_price) ?? '0',
      slippageBps: row.slippage_bps,
      status: row.status as LimitOrderDto['status'],
      armed: row.signed_swap_tx != null,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
      triggeredAt: row.triggered_at ? row.triggered_at.toISOString() : null,
      filledAt: row.filled_at ? row.filled_at.toISOString() : null,
      txHash: row.tx_hash,
      explorerUrl: row.tx_hash
        ? buildExplorerTxUrl(row.chain_id, row.tx_hash)
        : null,
      failureReason: row.failure_reason,
    };
  }

  // ---------- 校验与工具 ----------

  private resolveChainId(chainId?: number): number {
    if (chainId === undefined) {
      return DEFAULT_CHAIN_ID;
    }
    if (!isSupportedChainId(chainId)) {
      throw new BadRequestException(
        `不支持的 chainId: ${chainId}（支持 8453 / 84532）`,
      );
    }
    return chainId;
  }

  private assertAddress(address: string, label: string): string {
    const normalized = normalizeAddress(String(address ?? '').trim());
    if (!isValidAddress(normalized)) {
      throw new BadRequestException(`${label} 不是合法的 EVM 地址: ${address}`);
    }
    return normalized;
  }

  private assertPositiveAmount(raw: string, label: string): string {
    const s = String(raw ?? '').trim();
    if (!/^\d+$/.test(s)) {
      throw new BadRequestException(`${label} 必须为正整数字符串（链上原始单位）`);
    }
    if (BigInt(s) <= 0n) {
      throw new BadRequestException(`${label} 必须为正整数（链上原始单位）`);
    }
    return s;
  }

  private assertLimitPrice(raw: string): string {
    const s = String(raw ?? '').trim();
    if (!DECIMAL_RE.test(s)) {
      throw new BadRequestException(`limitPrice 必须是正十进制字符串: ${raw}`);
    }
    let scaled: bigint;
    try {
      scaled = parseDecimal(s, PRICE_SCALE);
    } catch {
      throw new BadRequestException(`limitPrice 非法: ${raw}`);
    }
    if (scaled <= 0n) {
      throw new BadRequestException(`limitPrice 必须大于 0: ${raw}`);
    }
    return s;
  }

  private assertDirection(direction?: string): LimitOrderDirection {
    const d = direction ?? 'buy';
    if (d !== 'buy') {
      throw new BadRequestException(`direction 仅支持 buy（收到: ${direction}）`);
    }
    return d;
  }

  private normalizeSlippageBps(slippageBps?: number): number {
    const s = slippageBps ?? 0;
    if (!Number.isInteger(s) || s < 0 || s > 10_000) {
      throw new BadRequestException(
        'slippageBps 必须是 0~10000 的整数（1 bps = 0.01%）',
      );
    }
    return s;
  }

  private resolveExpiresAt(expiresAt?: string): Date {
    const now = Date.now();
    const max = new Date(now + DEFAULT_LIMIT_ORDER_TTL_MS);
    if (expiresAt === undefined || expiresAt.trim() === '') {
      return max;
    }
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`expiresAt 不是合法的 ISO 时间: ${expiresAt}`);
    }
    if (d.getTime() <= now) {
      throw new BadRequestException('expiresAt 必须晚于当前时间');
    }
    return d.getTime() > max.getTime() ? max : d;
  }

  private assertStatus(status: string): string {
    if (!LIMIT_ORDER_STATUSES.includes(status)) {
      throw new BadRequestException(`非法的 status: ${status}`);
    }
    return status;
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

  private resolveDecimals(chainId: number, address: string): number {
    return getCatalogEntry(chainId, address)?.decimals ?? 18;
  }

  private dec(v: string): Prisma.Decimal {
    return new Prisma.Decimal(v);
  }

  private async readPendingNonce(chainId: number, user: string): Promise<number> {
    return this.rpc.getClient(chainId).getTransactionCount({
      address: user as `0x${string}`,
      blockTag: 'pending',
    });
  }

  private async estimateFees(chainId: number): Promise<{
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }> {
    try {
      const fees = await this.rpc.getClient(chainId).estimateFeesPerGas();
      const bumpPct = this.gasFeeBumpPct();
      const maxFee = (fees.maxFeePerGas * BigInt(bumpPct)) / 100n;
      const maxPriority = fees.maxPriorityFeePerGas ?? 0n;
      return {
        maxFeePerGas: maxFee.toString(),
        maxPriorityFeePerGas: maxPriority.toString(),
      };
    } catch (err) {
      this.logger.warn(`gas 费估算失败，使用兜底值: ${this.errMsg(err)}`);
      return {
        maxFeePerGas: this.defaultMaxFeePerGas().toString(),
        maxPriorityFeePerGas: DEFAULT_MAX_PRIORITY_FEE_PER_GAS.toString(),
      };
    }
  }

  private gasFeeBumpPct(): number {
    const raw = Number(
      process.env.LIMIT_ORDER_GAS_FEE_BUMP_PCT ?? DEFAULT_GAS_FEE_BUMP_PCT,
    );
    return Number.isFinite(raw) && raw >= 100
      ? Math.floor(raw)
      : DEFAULT_GAS_FEE_BUMP_PCT;
  }

  private defaultMaxFeePerGas(): bigint {
    const raw = Number(process.env.LIMIT_ORDER_MAX_FEE_PER_GAS_GWEI);
    return Number.isFinite(raw) && raw > 0
      ? BigInt(Math.floor(raw * 1e9))
      : DEFAULT_MAX_FEE_PER_GAS;
  }

  private buildNotifyBody(order: LimitOrder, type: string): string {
    if (type === 'limit_order_filled') {
      return `你的限价单已成交（amountIn=${order.amount_in.toString()}，minAmountOut=${order.min_amount_out.toString()}）`;
    }
    if (type === 'limit_order_failed') {
      return `你的限价单成交失败（原因：${order.failure_reason ?? '未知'}）`;
    }
    if (type === 'limit_order_expired') {
      return '你的限价单已过期';
    }
    return `你的限价单已更新（状态：${order.status}）`;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
