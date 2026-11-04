import type { Token } from '@prisma/client';

/**
 * Token 对外 DTO（camelCase，与前端 apps/web/src/types/token.ts 对齐）。
 */
export interface TokenDto {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  verified: boolean;
  risk: boolean;
  source: string | null;
}

export interface TokenListResult {
  items: TokenDto[];
  page: number;
  limit: number;
  total: number;
}

export interface TokenBalanceDto {
  chainId: number;
  address: string; // token 地址（小写）
  wallet: string; // 钱包地址（小写）
  symbol: string;
  decimals: number;
  raw: string; // 链上原始大整数（字符串，避免精度丢失）
  formatted: string; // 按 decimals 格式化后的字符串（纯字符串运算，无 Float）
}

export function toTokenDto(token: Token): TokenDto {
  return {
    chainId: token.chain_id,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logoURI: token.logo_uri,
    verified: token.is_verified,
    risk: token.risk,
    source: token.source,
  };
}
