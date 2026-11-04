"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketPrice, TokenDetail } from "@/types/market";
import {
  fetchTokenDetail,
  fetchTokenPrice,
  isMarketApiConfigured,
} from "@/services/market";

export interface UseTokenDetailResult {
  /** Token 元数据（远程 /tokens/:address，可能为 undefined 当 404）。 */
  token: TokenDetail | undefined;
  /** 价格（远程 /market/price，UNAVAILABLE 时为 priceUsd=null）。 */
  price: MarketPrice | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案。 */
  errorMessage?: string;
  /** 后端 API 是否已配置。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * Token 详情（元数据 + 价格并行拉取）。
 * - 元数据 404（token 未入库）不阻断页面：由调用方回退到本地 token 目录。
 * - 价格 UNAVAILABLE 属正常降级，priceUsd=null，不算错误。
 */
export function useTokenDetail(
  address: string | undefined,
  chainId: number,
): UseTokenDetailResult {
  const apiConfigured = isMarketApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const tokenQuery = useQuery<TokenDetail>({
    queryKey: ["token-detail", chainId, address],
    queryFn: () => fetchTokenDetail(chainId, address!),
    enabled,
    retry: false,
  });

  const priceQuery = useQuery<MarketPrice>({
    queryKey: ["token-price", chainId, address],
    queryFn: () => fetchTokenPrice(chainId, address!),
    enabled,
    retry: false,
  });

  const error = tokenQuery.error ?? priceQuery.error;
  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : undefined;

  return {
    token: tokenQuery.data,
    price: priceQuery.data,
    isLoading: enabled && (tokenQuery.isPending || priceQuery.isPending),
    isError: tokenQuery.isError || priceQuery.isError,
    errorMessage,
    apiConfigured,
    refetch: () => {
      tokenQuery.refetch();
      priceQuery.refetch();
    },
  };
}
