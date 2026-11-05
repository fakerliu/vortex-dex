import { Injectable } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { NotificationProvider } from './notification-provider.interface';
import type {
  CreateNotificationInput,
  NotificationDto,
} from './notifications.types';

/**
 * 站内通知渠道（契约 §5）：写 Notification 表。
 * 与 NotificationsService.createNotification 合一，不重复落库逻辑。
 */
@Injectable()
export class InAppProvider implements NotificationProvider {
  readonly name = 'in_app' as const;

  constructor(private readonly notificationsService: NotificationsService) {}

  send(notification: CreateNotificationInput): Promise<NotificationDto | null> {
    return this.notificationsService.createNotification(notification);
  }
}
