/**
 * 站内通知中心（V1.3）DTO。
 *
 * 通知无价格字段，金额铁律不涉及；地址一律小写规范化。
 * 响应信封由全局 transform.interceptor 统一包裹，controller 直接 return data。
 */

/** 返回的通知条目（camelCase，与前端契约 §6.3 对齐）。 */
export interface NotificationDto {
  id: string;
  userAddress: string;
  type: string; // 当前恒为 "price_alert_triggered"
  title: string;
  body: string;
  alertId: string | null;
  tokenAddress: string | null;
  read: boolean;
  createdAt: string; // ISO 字符串
}

/** GET /notifications/unread-count 返回。 */
export interface UnreadCountDto {
  count: number;
}

/** 创建站内通知的入参（落库前形态：type/title/body/alertId/tokenAddress）。 */
export interface CreateNotificationInput {
  userAddress: string;
  type: string;
  title: string;
  body: string;
  alertId?: string | null;
  tokenAddress?: string | null;
}
