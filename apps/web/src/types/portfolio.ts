import type { Authenticity } from "@/types/market";

/**
 * 资产中心相关类型（与后端 GET /users/:address/portfolio 契约对齐，Sprint 4）。
 *
 * 金额铁律（与 market/swap 保持一致）：
 * - `balance`：链上原始大整数（最小单位）字符串；
 * - `balanceFormatted` / `priceUsd` / `valueUsd` / `totalValueUsd`：十进制字符串；
 * - 全程禁 JS Float。
 */

/** 单个 token 的持仓条目（PortfolioDto.items[]）。 */
export interface PortfolioTokenDto {
  chainId: number;
  /** 小写规范化合约地址。 */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  /** 链上原始大整数（最小单位）字符串。 */
  balance: string;
  /** 按 decimals 格式化后的人类可读余额（十进制字符串）。 */
  balanceFormatted: string;
  /** USD 价格（十进制字符串）；上游不可用时为 null。 */
  priceUsd: string | null;
  /** USD 估值（十进制字符串）；价格不可用时为 null。 */
  valueUsd: string | null;
  /** 价格真实度标记（DataAuthenticity 枚举，与市场模块一致）。 */
  authenticity: Authenticity;
}

/** 用户资产组合（GET /users/:address/portfolio 的 data 部分）。 */
export interface PortfolioDto {
  /** 钱包地址（小写规范化）。 */
  address: string;
  chainId: number;
  items: PortfolioTokenDto[];
  /** 总估值（USD 十进制字符串）。 */
  totalValueUsd: string;
}
