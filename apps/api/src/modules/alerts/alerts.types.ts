/**
 * Price Alerts（价格提醒）模块 DTO（V1.2）。
 *
 * 金额铁律：targetPrice 一律为「十进制字符串」（如 "2500"），由 BigInt 定点
 * 运算校验，绝不使用 Float。地址一律小写规范化。
 */

/** 提醒条件：gte = 涨到（>= 目标价触发）；lte = 跌到（<= 目标价触发）。 */
export type AlertCondition = 'gte' | 'lte';

/** 通知方式（V1.2 仅 in_app 生效，email/webhook 字段预留）。 */
export type NotifyMethod = 'in_app' | 'email' | 'webhook';

/** 提醒状态。 */
export type AlertStatus = 'active' | 'triggered' | 'paused';

/** 创建提醒请求体。 */
export interface CreateAlertRequestDto {
  userAddress: string;
  chainId: number;
  tokenAddress: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: string; // 十进制字符串，如 "2500"
  notifyMethod?: NotifyMethod; // 默认 in_app
}

/** 更新提醒请求体（全部可选，部分更新）。 */
export interface UpdateAlertRequestDto {
  condition?: AlertCondition;
  targetPrice?: string; // 十进制字符串
  notifyMethod?: NotifyMethod;
  status?: AlertStatus;
}

/** 返回的 alert 条目（camelCase）。 */
export interface PriceAlertDto {
  id: string;
  userAddress: string;
  chainId: number;
  tokenAddress: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: string; // 十进制字符串
  notifyMethod: string;
  status: AlertStatus;
  triggeredAt: string | null; // ISO 字符串
  createdAt: string;
}

/** POST /alerts/check 返回。 */
export interface CheckAlertsResult {
  checked: number; // 本次检查的 active 提醒数
  triggered: PriceAlertDto[]; // 命中的提醒
}
