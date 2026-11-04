"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketRankingResult, MarketRankingSortBy } from "@/types/market";
import { fetchMarketRanking, isMarketApiConfigured } from "@/services/market";

export interface UseMarketRankingResult {
  data: MarketRankingResult | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案。 */
  errorMessage?: string;
  /** 后端 API 是否已配置（未配置时前端明确显示「待接入」，不发请求）。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * Explore 代币榜单（TanStack Query 封装）。
 * 后端已按 sortBy 排序并 join Token 元信息 + 聚合成交量，前端不再自行排序。
 * 未配置 API 地址时不发起请求。
 */
export function useMarketRanking(
  chainId: number,
  sortBy?: MarketRankingSortBy,
  limit?: number,
): UseMarketRankingResult {
  const apiConfigured = isMarketApiConfigured();

  const query = useQuery<MarketRankingResult>({
    queryKey: ["market-ranking", chainId, sortBy, limit],
    queryFn: () => fetchMarketRanking(chainId, sortBy, limit),
    enabled: apiConfigured,
    retry: false,
  });

  const errorMessage = query.error
    ? query.error instanceof Error
      ? query.error.message
      : String(query.error)
    : undefined;

  return {
    data: query.data,
    isLoading: apiConfigured && query.isPending,
    isError: query.isError,
    errorMessage,
    apiConfigured,
    refetch: query.refetch,
  };
}
