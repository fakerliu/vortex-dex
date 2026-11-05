/**
 * 站内通知（Notifications）相关类型（与后端 V1.3 notifications 模块契约对齐）。
 *
 * 地址一律小写规范化；`createdAt` 为 ISO 字符串。字段与后端 `NotificationDto`
 * 的 camelCase 形态一一对应。
 */

/** 通知类型（当前恒为 price_alert_triggered，预留其他类型）。 */
export type NotificationType = "price_alert_triggered";

/** 单条站内通知（后端 NotificationDto）。 */
export interface Notification {
  id: string;
  userAddress: string;
  type: NotificationType;
  title: string;
  body: string;
  /** 关联价格提醒（可空）。 */
  alertId: string | null;
  /** 关联 token（可空）。 */
  tokenAddress: string | null;
  read: boolean;
  /** ISO 字符串。 */
  createdAt: string;
}

/** GET /notifications/unread-count 返回（后端 UnreadCountDto）。 */
export interface UnreadCount {
  count: number;
}
