import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PriceAlert } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import { parseDecimal } from '../../dex/math';
import type {
  AlertCondition,
  AlertStatus,
  CheckAlertsResult,
  CreateAlertRequestDto,
  NotifyMethod,
  PriceAlertDto,
  UpdateAlertRequestDto,
} from './alerts.types';

/** 定点小数精度（与 dex/math 的 parseDecimal 一致，18 位）。 */
const PRICE_SCALE = 18n;

const CONDITIONS: AlertCondition[] = ['gte', 'lte'];
const NOTIFY_METHODS: NotifyMethod[] = ['in_app', 'email', 'webhook'];
const STATUSES: AlertStatus[] = ['active', 'triggered', 'paused'];

/** 正十进制字符串（允许整数或小数，如 "2500" / "2500.5"）。 */
const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Prisma.Decimal -> 干净十进制字符串（去尾零），null 透传。 */
function decimalToString(d: Prisma.Decimal | null | undefined): string | null {
  if (d == null) {
    return null;
  }
  let s = d.toString();
  if (s.includes('.')) {
    s = s.replace(/0+$/, '');
    s = s.replace(/\.$/, '');
  }
  return s;
}

/**
 * Price Alerts 服务（V1.2）。
 *
 * 只依赖 PrismaService（读 market_snapshots + price_alerts 表），
 * 不注入 MarketService —— 惰性触发由 Market 模块单向调用，避免循环依赖。
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 创建提醒。 */
  async createAlert(req: CreateAlertRequestDto): Promise<PriceAlertDto> {
    const userAddress = this.assertUserAddress(req.userAddress);
    const tokenAddress = this.assertTokenAddress(req.tokenAddress);
    const condition = this.assertCondition(req.condition);
    const targetPrice = this.assertTargetPrice(req.targetPrice);
    const notifyMethod = this.assertNotifyMethod(req.notifyMethod);

    const row = await this.prisma.priceAlert.create({
      data: {
        user_address: userAddress,
        chain_id: req.chainId,
        token_address: tokenAddress,
        symbol: req.symbol,
        condition,
        target_price: targetPrice,
        notify_method: notifyMethod,
        status: 'active',
      },
    });

    return this.toAlertDto(row);
  }

  /** 列出某用户提醒（created_at 降序）。 */
  async listAlerts(userAddress: string): Promise<PriceAlertDto[]> {
    const addr = this.assertUserAddress(userAddress);
    const rows = await this.prisma.priceAlert.findMany({
      where: { user_address: addr },
      orderBy: { created_at: 'desc' },
    });
    return rows.map((r) => this.toAlertDto(r));
  }

  /** 部分更新（condition / targetPrice / notifyMethod / status）。 */
  async updateAlert(
    id: string,
    req: UpdateAlertRequestDto,
  ): Promise<PriceAlertDto> {
    const data: Prisma.PriceAlertUpdateInput = {};
    if (req.condition !== undefined) {
      data.condition = this.assertCondition(req.condition);
    }
    if (req.targetPrice !== undefined) {
      data.target_price = this.assertTargetPrice(req.targetPrice);
    }
    if (req.notifyMethod !== undefined) {
      data.notify_method = this.assertNotifyMethod(req.notifyMethod);
    }
    if (req.status !== undefined) {
      data.status = this.assertStatus(req.status);
    }

    const existing = await this.prisma.priceAlert.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`提醒不存在: ${id}`);
    }

    const row = await this.prisma.priceAlert.update({
      where: { id },
      data,
    });
    return this.toAlertDto(row);
  }

  /** 删除提醒。 */
  async deleteAlert(id: string): Promise<void> {
    const existing = await this.prisma.priceAlert.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`提醒不存在: ${id}`);
    }
    await this.prisma.priceAlert.delete({ where: { id } });
  }

  /**
   * 惰性触发核心：读所有 active 提醒，比对 market_snapshots 最新价格，
   * 命中则置 triggered + triggered_at。失败静默（不抛），不拖垮主流程。
   */
  async checkPriceAlerts(): Promise<CheckAlertsResult> {
    try {
      const active = await this.prisma.priceAlert.findMany({
        where: { status: 'active' },
      });

      const triggered: PriceAlertDto[] = [];
      for (const alert of active) {
        const snapshot = await this.prisma.marketSnapshot.findFirst({
          where: {
            chain_id: alert.chain_id,
            token_address: alert.token_address,
            price_usd: { not: null },
          },
          orderBy: { created_at: 'desc' },
        });
        // 无快照 / price_usd 为 null → 跳过（不触发）。
        if (!snapshot || snapshot.price_usd == null) {
          continue;
        }

        const latest = parseDecimal(snapshot.price_usd.toString(), PRICE_SCALE);
        const target = parseDecimal(alert.target_price.toString(), PRICE_SCALE);
        const hit =
          alert.condition === 'gte' ? latest >= target : latest <= target;
        if (!hit) {
          continue;
        }

        const updated = await this.prisma.priceAlert.update({
          where: { id: alert.id },
          data: { status: 'triggered', triggered_at: new Date() },
        });
        triggered.push(this.toAlertDto(updated));
      }

      return { checked: active.length, triggered };
    } catch (err) {
      this.logger.warn(`checkPriceAlerts 失败: ${this.errMsg(err)}`);
      return { checked: 0, triggered: [] };
    }
  }

  // ---------- DTO 转换 ----------

  /** Prisma 行 -> PriceAlertDto（Decimal 去尾零，Date -> ISO 或 null）。 */
  private toAlertDto(row: PriceAlert): PriceAlertDto {
    return {
      id: row.id,
      userAddress: row.user_address,
      chainId: row.chain_id,
      tokenAddress: row.token_address,
      symbol: row.symbol,
      condition: row.condition as AlertCondition,
      targetPrice: decimalToString(row.target_price) ?? '0',
      notifyMethod: row.notify_method,
      status: row.status as AlertStatus,
      triggeredAt: row.triggered_at ? row.triggered_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }

  // ---------- 校验 ----------

  private assertUserAddress(address: string): string {
    // 先规范化（小写）再校验：共享的 isValidAddress 区分大小写，
    // 规范化前先小写，使 0X 前缀 / 大写十六进制也能正确通过并归一为 0x。
    const normalized = normalizeAddress(address);
    if (!isValidAddress(normalized)) {
      throw new BadRequestException(`userAddress 不是合法的 EVM 地址: ${address}`);
    }
    return normalized;
  }

  private assertTokenAddress(address: string): string {
    const normalized = normalizeAddress(address);
    if (!isValidAddress(normalized)) {
      throw new BadRequestException(
        `tokenAddress 不是合法的 EVM 地址: ${address}`,
      );
    }
    return normalized;
  }

  private assertCondition(condition: string): AlertCondition {
    if (!CONDITIONS.includes(condition as AlertCondition)) {
      throw new BadRequestException(
        `condition 只允许 gte / lte，收到: ${condition}`,
      );
    }
    return condition as AlertCondition;
  }

  /** 正十进制字符串校验（BigInt 定点，禁 Float），返回规范化字符串。 */
  private assertTargetPrice(raw: string): string {
    const s = raw.trim();
    if (!DECIMAL_RE.test(s)) {
      throw new BadRequestException(`targetPrice 必须是正十进制字符串: ${raw}`);
    }
    let v: bigint;
    try {
      v = parseDecimal(s, PRICE_SCALE);
    } catch {
      throw new BadRequestException(`targetPrice 非法: ${raw}`);
    }
    if (v <= 0n) {
      throw new BadRequestException(`targetPrice 必须大于 0: ${raw}`);
    }
    return s;
  }

  private assertNotifyMethod(method: NotifyMethod | undefined): NotifyMethod {
    if (method === undefined) {
      return 'in_app';
    }
    if (!NOTIFY_METHODS.includes(method)) {
      throw new BadRequestException(
        `notifyMethod 只允许 in_app / email / webhook，收到: ${method}`,
      );
    }
    return method;
  }

  private assertStatus(status: string): AlertStatus {
    if (!STATUSES.includes(status as AlertStatus)) {
      throw new BadRequestException(
        `status 只允许 active / triggered / paused，收到: ${status}`,
      );
    }
    return status as AlertStatus;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
