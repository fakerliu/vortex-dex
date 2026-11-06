"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MarketRankingResult, MarketRankingSortBy } from "@/types/market";
import { fetchMarketRanking, isMarketApiConfigured } from "@/services/market";

export interface UseMarketRankingResult {
  data: MarketRankingResult | undefined;
  isLoading: boolean;
  /** 后台刷新中（切页 / 搜索 / 换排序时保留旧数据并置灰）。 */
  isFetching: boolean;
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
 *
 * sortBy=price 归一化为「不传 sortBy」：后端把未传 sortBy 当作 price 降序，
 * 且 controller 不接受 sortBy=price（会 400）。
 */
export function useMarketRanking(
  chainId: number,
  sortBy?: MarketRankingSortBy,
  limit?: number,
  q?: string,
  page?: number,
): UseMarketRankingResult {
  const apiConfigured = isMarketApiConfigured();

  const effectiveSortBy =
    sortBy && sortBy !== "price" ? sortBy : undefined;
  const effectiveQ = q?.trim() || undefined;

  const query = useQuery<MarketRankingResult>({
    queryKey: [
      "market-ranking",
      chainId,
      effectiveSortBy,
      limit,
      effectiveQ,
      page,
    ],
    queryFn: () =>
      fetchMarketRanking(chainId, effectiveSortBy, limit, effectiveQ, page),
    enabled: apiConfigured,
    placeholderData: keepPreviousData,
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
    isFetching: query.isFetching,
    isError: query.isError,
    errorMessage,
    apiConfigured,
    refetch: query.refetch,
  };
}
