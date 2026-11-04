import type { Authenticity } from "@/types/market";

/**
 * Approval 授权管理相关类型（与后端 GET /approvals/:wallet 契约对齐，Sprint 5）。
 *
 * 金额铁律（与 market/portfolio/swap 保持一致）：
 * - `allowance`：链上原始大整数（最小单位）字符串；
 * - `allowanceFormatted`：按 decimals 格式化后的人类可读额度（十进制字符串）；
 * - 全程禁 JS Float。
 */

/** 单个 token 的授权条目（ApprovalListResult.items[]）。 */
export interface ApprovalItemDto {
  chainId: number;
  /** 钱包地址（小写规范化）。 */
  wallet: string;
  /** token 合约地址（小写规范化）。 */
  token: string;
  /** 自定义 token 链上读不到元数据时为 null。 */
  symbol: string | null;
  decimals: number;
  /** 被授权方（DEX 聚合器合约）地址（小写规范化）。 */
  spender: string;
  /** 链上原始大整数（最小单位）字符串。 */
  allowance: string;
  /** 按 decimals 格式化后的人类可读额度（十进制字符串）。 */
  allowanceFormatted: string;
  /** 是否已存在非零授权额度。 */
  hasAllowance: boolean;
  /** 数据真实度标记（DataAuthenticity 枚举，与市场模块一致）。 */
  authenticity: Authenticity;
}

/** 授权列表结果（GET /approvals/:wallet 的 data 部分）。 */
export interface ApprovalListResult {
  /** 钱包地址（小写规范化）。 */
  wallet: string;
  chainId: number;
  /** 被授权方（DEX 聚合器合约）地址。 */
  spender: string;
  items: ApprovalItemDto[];
}
