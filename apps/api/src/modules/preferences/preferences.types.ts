/**
 * 用户偏好模块（V1.2 Preferences）对外 DTO（camelCase）。
 *
 * 契约见 docs/v1.2-contract.md §3.3。
 * 地址一律小写规范化；favoriteTokens 是用户收藏的代币列表。
 */

/** 单个收藏代币。 */
export interface FavoriteTokenDto {
  chainId: number;
  address: string; // 小写规范化
  symbol: string;
}

/** 用户偏好对外 DTO。 */
export interface UserPreferenceDto {
  userAddress: string;
  defaultSlippageBps: number; // 默认 50
  defaultChainId: number; // 默认 8453
  defaultDeadlineSec: number; // 默认 1200
  notifyAlerts: boolean; // 默认 true
  favoriteTokens: FavoriteTokenDto[]; // 默认 []
}

/** PUT /preferences/:address 请求体（全部可选，部分更新）。 */
export interface UpdatePreferenceRequestDto {
  defaultSlippageBps?: number;
  defaultChainId?: number;
  defaultDeadlineSec?: number;
  notifyAlerts?: boolean;
}
