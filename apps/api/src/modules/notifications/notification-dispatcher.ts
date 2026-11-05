import { Injectable, Logger } from '@nestjs/common';
import { InAppProvider } from './in-app.provider';
import type {
  CreateNotificationInput,
  NotificationDto,
} from './notifications.types';

/**
 * 通知分派（契约 §5 降级策略）。
 * notifyMethod=in_app 走站内；email/webhook 未接入，降级为站内 + warn「渠道未接入」。
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(private readonly inAppProvider: InAppProvider) {}

  async dispatch(
    method: string,
    notification: CreateNotificationInput,
  ): Promise<NotificationDto | null> {
    if (method === 'in_app') {
      return this.inAppProvider.send(notification);
    }
    this.logger.warn(`通知渠道「${method}」未接入，降级为站内通知`);
    return this.inAppProvider.send(notification);
  }
}
