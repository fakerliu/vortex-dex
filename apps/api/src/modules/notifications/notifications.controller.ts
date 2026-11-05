import { Controller } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * 站内通知中心 API（V1.3，挂 /api/v1 前缀，路由 /api/v1/notifications）。
 *
 * 端点（由 V1.3-2a 工程师填充实现）：
 * - GET    /notifications?user=:address       列出用户通知
 * - PATCH  /notifications/:id/read            标记已读
 * - POST   /notifications/read-all            全部已读（body: { userAddress }）
 * - GET    /notifications/unread-count?user=:address  未读数（顶栏角标）
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // TODO(V1.3-2a): 由工程师填充实现。
}
