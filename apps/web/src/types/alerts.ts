/**
 * 价格提醒（Price Alerts）相关类型（与后端 V1.2 alerts 模块契约对齐）。
 *
 * 金额铁律：`targetPrice` 为十进制字符串（如 "2500"），展示/比较均用字符串，
 * 禁 JS Float。地址一律小写规范化。
 */

/** 提醒条件：gte = 涨到（最新价 >= 目标价触发）；lte = 跌到（最新价 <= 目标价触发）。 */
export type AlertCondition = "gte" | "lte";

/** 通知方式（V1.2 仅 in_app 生效，email/webhook 字段预留）。 */
export type NotifyMethod = "in_app" | "email" | "webhook";

/** 提醒状态。 */
export type AlertStatus = "active" | "triggered" | "paused";

/** 单条价格提醒（后端 PriceAlertDto）。 */
export interface PriceAlert {
  id: string;
  userAddress: string;
  chainId: number;
  tokenAddress: string;
  symbol: string;
  condition: AlertCondition;
  /** 目标价（USD 十进制字符串）。 */
  targetPrice: string;
  notifyMethod: string;
  status: AlertStatus;
  /** ISO 字符串；未触发为 null。 */
  triggeredAt: string | null;
  createdAt: string;
}

/** 创建提醒请求体。 */
export interface CreateAlertParams {
  userAddress: string;
  chainId: number;
  tokenAddress: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: string;
  notifyMethod?: NotifyMethod;
}

/** 更新提醒请求体（全部可选，部分更新）。 */
export interface UpdateAlertParams {
  condition?: AlertCondition;
  targetPrice?: string;
  notifyMethod?: NotifyMethod;
  status?: AlertStatus;
}

/** POST /alerts/check 返回。 */
export interface CheckAlertsResult {
  /** 本次检查的 active 提醒数。 */
  checked: number;
  /** 命中的提醒列表。 */
  triggered: PriceAlert[];
}
