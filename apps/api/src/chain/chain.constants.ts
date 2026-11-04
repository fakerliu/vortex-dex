/**
 * 链层常量：支持的链、默认公共 RPC、链名称。
 * RPC 地址可通过环境变量注入（BASE_MAINNET_RPC_URL / BASE_SEPOLIA_RPC_URL）。
 */

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const SUPPORTED_CHAIN_IDS = [
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export const DEFAULT_RPC_URLS: Record<number, string> = {
  [BASE_MAINNET_CHAIN_ID]: 'https://mainnet.base.org',
  [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.base.org',
};

export const CHAIN_NAMES: Record<number, string> = {
  [BASE_MAINNET_CHAIN_ID]: 'base',
  [BASE_SEPOLIA_CHAIN_ID]: 'base-sepolia',
};

/** 区块浏览器根地址（按 chain_id）。 */
export const EXPLORER_URLS: Record<number, string> = {
  [BASE_MAINNET_CHAIN_ID]: 'https://basescan.org',
  [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.basescan.org',
};

/** 构造区块浏览器交易链接（交易 Hash 核验用）。 */
export function buildExplorerTxUrl(chainId: number, txHash: string): string {
  const base = EXPLORER_URLS[chainId] ?? 'https://basescan.org';
  return `${base}/tx/${txHash}`;
}

export function isSupportedChainId(
  chainId: number,
): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `chain-${chainId}`;
}
