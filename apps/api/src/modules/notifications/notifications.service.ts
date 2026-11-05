import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidAddress, normalizeAddress } from '../../chain/address';
import type {
  CreateNotificationInput,
  NotificationDto,
  UnreadCountDto,
} from './notifications.types';

/**
 * 站内通知中心服务（V1.3）。
 *
 * 职责：
 * - createNotification：写一条站内通知（幂等：同一 alert 只落一次）。
 * - listNotifications：列出某用户通知（未读优先、created_at 降序）。
 * - markRead / markAllRead：标记已读 / 全部已读。
 * - unreadCount：返回某用户未读数（供前端顶栏角标）。
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 落一条站内通知。
   *
   * 幂等：传入 alertId 时，同一 alert 只落一条——先查该 alert 是否已有通知，
   * 有则跳过并返回 null。配合 checkPriceAlerts 的 status=active 过滤，双重防重复。
   */
  async createNotification(
    input: CreateNotificationInput,
  ): Promise<NotificationDto | null> {
    const userAddress = this.assertUserAddress(input.userAddress);
    const tokenAddress =
      input.tokenAddress != null && input.tokenAddress !== ''
        ? this.assertTokenAddress(input.tokenAddress)
        : null;

    if (input.alertId != null && input.alertId !== '') {
      const existing = await this.prisma.notification.findFirst({
        where: { alert_id: input.alertId },
        select: { id: true },
      });
      if (existing) {
        return null;
      }
    }

    const row = await this.prisma.notification.create({
      data: {
        user_address: userAddress,
        type: input.type,
        title: input.title,
        body: input.body,
        alert_id: input.alertId ?? null,
        token_address: tokenAddress,
        read: false,
      },
    });
    return this.toDto(row);
  }

  /** 列出某用户通知（未读优先 read 升序，created_at 降序）。 */
  async listNotifications(userAddress: string): Promise<NotificationDto[]> {
    const addr = this.assertUserAddress(userAddress);
    const rows = await this.prisma.notification.findMany({
      where: { user_address: addr },
      orderBy: [{ read: 'asc' }, { created_at: 'desc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  /** 标记单条已读。 */
  async markRead(id: string): Promise<NotificationDto> {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`通知不存在: ${id}`);
    }
    const row = await this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return this.toDto(row);
  }

  /** 全部已读，返回本次更新的条数。 */
  async markAllRead(userAddress: string): Promise<{ updated: number }> {
    const addr = this.assertUserAddress(userAddress);
    const res = await this.prisma.notification.updateMany({
      where: { user_address: addr, read: false },
      data: { read: true },
    });
    return { updated: res.count };
  }

  /** 未读数（供顶栏角标）。 */
  async unreadCount(userAddress: string): Promise<UnreadCountDto> {
    const addr = this.assertUserAddress(userAddress);
    const count = await this.prisma.notification.count({
      where: { user_address: addr, read: false },
    });
    return { count };
  }

  // ---------- DTO 转换 ----------

  private toDto(row: Notification): NotificationDto {
    return {
      id: row.id,
      userAddress: row.user_address,
      type: row.type,
      title: row.title,
      body: row.body,
      alertId: row.alert_id,
      tokenAddress: row.token_address,
      read: row.read,
      createdAt: row.created_at.toISOString(),
    };
  }

  // ---------- 校验 ----------

  private assertUserAddress(address: string): string {
    // 先规范化（小写）再校验：与 alerts.service 的 assertUserAddress 一致。
    const normalized = normalizeAddress(address);
    if (!isValidAddress(normalized)) {
      throw new BadRequestException(
        `userAddress 不是合法的 EVM 地址: ${address}`,
      );
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
}
