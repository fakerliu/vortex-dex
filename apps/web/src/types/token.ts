import type { SupportedChainId } from "@/config/chains";

export interface Token {
  chainId: SupportedChainId;
  /** 校验和地址；后续原生 ETH 用零地址/sentinel 表示 */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  /** 是否来自可信列表并通过校验 */
  verified?: boolean;
  /** 风险标记（社区代币/新代币，需用户确认） */
  risk?: boolean;
}
