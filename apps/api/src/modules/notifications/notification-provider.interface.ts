import type {
  CreateNotificationInput,
  NotificationDto,
} from './notifications.types';

/** 通知渠道。与 alerts 的 NotifyMethod 取值一致（in_app / email / webhook）。 */
export type NotificationChannel = 'in_app' | 'email' | 'webhook';

/**
 * 可插拔通知渠道抽象（契约 §5）。
 *
 * - in_app：写 Notification 表（InAppProvider 委托 NotificationsService.createNotification，合一不重复）。
 * - email / webhook：V1.3 未接入真实发送，由 NotificationDispatcher 降级为站内 + warn「渠道未接入」。
 */
export interface NotificationProvider {
  readonly name: NotificationChannel;
  send(notification: CreateNotificationInput): Promise<NotificationDto | null>;
}
