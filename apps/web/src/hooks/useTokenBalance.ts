"use client";

import { useAccount, useReadContract } from "wagmi";
import { erc20Abi, zeroAddress } from "viem";
import type { Token } from "@/types/token";
import { formatTokenAmount } from "@/utils/format";

export interface TokenBalance {
  /** 最小单位（wei）字符串 */
  raw: string;
  /** 人类可读 */
  formatted: string;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * 读取钱包在指定 ERC20 Token 上的余额（真实链上读取）。
 * 未连接钱包时返回 0，不发起请求。
 */
export function useTokenBalance(token: Token | null): TokenBalance {
  const { address, isConnected } = useAccount();

  const enabled = Boolean(token && isConnected && address);

  const result = useReadContract({
    address: (token?.address ?? zeroAddress) as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [(address ?? zeroAddress) as `0x${string}`],
    chainId: token?.chainId,
    query: { enabled },
  });

  const raw = result.data ? result.data.toString() : "0";

  return {
    raw,
    formatted: token ? formatTokenAmount(raw, token.decimals) : "0",
    isLoading: result.isLoading,
    isError: result.isError,
    refetch: result.refetch,
  };
}
