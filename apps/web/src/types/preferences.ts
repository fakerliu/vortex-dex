/**
 * 用户偏好（Preferences）相关类型（与后端 V1.2 preferences 模块契约对齐）。
 *
 * 地址一律小写规范化；`favoriteTokens` 为用户收藏的代币列表。
 */

/** 单个收藏代币。 */
export interface FavoriteToken {
  chainId: number;
  /** 小写规范化合约地址。 */
  address: string;
  symbol: string;
}

/** 用户偏好（后端 UserPreferenceDto）。 */
export interface UserPreference {
  userAddress: string;
  /** 默认滑点（bps），默认 50（即 0.5%）。 */
  defaultSlippageBps: number;
  /** 默认链 ID，默认 8453。 */
  defaultChainId: number;
  /** 默认交易 deadline（秒），默认 1200。 */
  defaultDeadlineSec: number;
  /** 是否接收提醒通知，默认 true。 */
  notifyAlerts: boolean;
  /** 收藏代币列表，默认 []。 */
  favoriteTokens: FavoriteToken[];
}

/** PUT /preferences/:address 请求体（全部可选，部分更新）。 */
export interface UpdatePreferenceParams {
  defaultSlippageBps?: number;
  defaultChainId?: number;
  defaultDeadlineSec?: number;
  notifyAlerts?: boolean;
}

/** POST /preferences/:address/favorites 请求体。 */
export interface AddFavoriteParams {
  chainId: number;
  address: string;
  symbol: string;
}
