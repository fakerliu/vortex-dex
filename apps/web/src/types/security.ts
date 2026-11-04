import type { Authenticity } from "@/types/market";

/**
 * Token Security 安全中心相关类型（与后端 GET /security/token/:address 契约对齐，Sprint 5）。
 */

/** Token 安全信息（GET /security/token/:address 的 data 部分）。 */
export interface TokenSecurityDto {
  chainId: number;
  /** token 合约地址（小写规范化）。 */
  address: string;
  /** 自定义 token 链上读不到元数据时为 null。 */
  symbol: string | null;
  /** 自定义 token 链上读不到元数据时为 null。 */
  name: string | null;
  /** 是否通过可信列表校验。 */
  verified: boolean;
  /** 风险标记（社区代币 / 新代币，需用户谨慎）。 */
  risk: boolean;
  /**
   * 链上是否存在合约代码（布尔三态）：
   * - true：已部署合约；
   * - false：EOA / 未部署；
   * - null：链上 getBytecode 读取失败，未知。
   */
  hasContractCode: boolean | null;
  /** 是否在官方 token 目录中。 */
  isInCatalog: boolean;
  /** 数据真实度标记（DataAuthenticity 枚举，与市场模块一致）。 */
  authenticity: Authenticity;
}
