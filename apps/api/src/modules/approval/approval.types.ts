import type { DataAuthenticity } from '../../common/constants/data-authenticity';

/**
 * Approval 模块对外 DTO（camelCase）。
 * 所有金额字段一律为字符串（BigInt 原始值），绝不使用 Float。
 */
export interface ApprovalDto {
  chainId: number;
  wallet: string; // 钱包地址（小写规范化）
  token: string; // token 地址（小写规范化）
  symbol: string | null; // catalog / 链上元数据取得的 symbol，未知为 null
  decimals: number; // 用于 allowanceFormatted 的精度
  spender: string; // Router 地址（小写规范化）
  allowance: string; // 链上 allowanceOf 原始大整数（字符串）
  allowanceFormatted: string; // 按 decimals 格式化后的字符串
  hasAllowance: boolean; // allowance > 0
  authenticity: DataAuthenticity; // 恒为 REAL_ONCHAIN（链上 allowanceOf 直接读取）
}

export interface ApprovalListResult {
  wallet: string;
  chainId: number;
  spender: string;
  items: ApprovalDto[];
}
