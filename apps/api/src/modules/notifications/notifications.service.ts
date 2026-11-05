import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 站内通知中心服务（V1.3）。
 *
 * 职责（由 V1.3-2a 工程师填充实现）：
 * - createNotification：价格提醒触发时落一条站内通知（幂等：同一 alert 触发只落一次）。
 * - listNotifications：列出某用户通知（未读优先、created_at 降序）。
 * - markRead / markAllRead：标记已读 / 全部已读。
 * - unreadCount：返回某用户未读数（供前端顶栏角标）。
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // TODO(V1.3-2a): 由工程师填充实现。
}
