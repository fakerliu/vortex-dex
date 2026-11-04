import type { DataAuthenticity } from '../../common/constants/data-authenticity';

/**
 * Security 模块对外 DTO（MODULE 08 Token Security 安全中心）。
 */
export interface TokenSecurityDto {
  chainId: number;
  address: string; // token 地址（小写规范化）
  symbol: string | null;
  name: string | null;
  verified: boolean; // 来自 token-catalog / DB
  risk: boolean; // 来自 token-catalog / DB（风险代币需用户确认）
  hasContractCode: boolean | null; // 链上 getBytecode 非空；读取失败为 null
  isInCatalog: boolean; // 是否在官方 token-catalog 内
  authenticity: DataAuthenticity; // 安全判定数据来源
}
