/**
 * VORTEX DEX 支持的链与链级常量。
 * 仅包含 Base 主网与 Base Sepolia 测试网（本项目目标链）。
 */

export type ChainId = 8453 | 84532;

export interface ChainConfig {
  id: ChainId;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrl: string;
}

export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

export const CHAINS: Record<ChainId, ChainConfig> = {
  [BASE_MAINNET_CHAIN_ID]: {
    id: BASE_MAINNET_CHAIN_ID,
    name: 'Base Mainnet',
    rpcUrl: 'https://mainnet.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrl: 'https://basescan.org',
  },
  [BASE_SEPOLIA_CHAIN_ID]: {
    id: BASE_SEPOLIA_CHAIN_ID,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrl: 'https://sepolia.basescan.org',
  },
};

export const DEFAULT_CHAIN_ID: ChainId = BASE_MAINNET_CHAIN_ID;

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId as ChainId];
}
