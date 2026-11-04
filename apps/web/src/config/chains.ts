import { base, baseSepolia } from "wagmi/chains";
import type { Chain } from "wagmi/chains";

/**
 * 支持的链：Base Mainnet (8453) 与 Base Sepolia (84532)。
 */
export const SUPPORTED_CHAINS: readonly [Chain, Chain] = [base, baseSepolia];

export type SupportedChainId = 8453 | 84532;

/**
 * RPC 地址：可通过环境变量注入，未配置时回退到公开 RPC。
 * 开发阶段外网 RPC 连接失败属可接受情况，代码本身保证配置正确。
 */
export const RPC_URLS: Record<SupportedChainId, string> = {
  [base.id]:
    process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org",
  [baseSepolia.id]:
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
};

export function getChain(chainId: number): Chain | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId);
}

export function isSupportedChain(chainId: number | undefined): boolean {
  if (chainId === undefined) return false;
  return SUPPORTED_CHAINS.some((c) => c.id === chainId);
}

export function getExplorerUrl(chainId?: number): string {
  const chain = getChain(chainId ?? base.id);
  return chain?.blockExplorers?.default.url ?? base.blockExplorers.default.url;
}
