"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SwapHistoryParams, SwapHistoryResult } from "@/types/history";
import { getSwapHistory, isSwapApiConfigured } from "@/services/swap";

export interface UseSwapHistoryResult {
  data: SwapHistoryResult | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案。 */
  errorMessage?: string;
  /** 后端 API 是否已配置（未配置时前端明确显示「待接入」，不发请求）。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * 用户交易历史查询封装（TanStack Query）。
 * - 未配置 API 地址或未提供钱包地址时不发起请求。
 * - 分页切换时保留上一页数据，避免列表闪空。
 */
export function useSwapHistory(
  address: string | undefined,
  params: SwapHistoryParams,
): UseSwapHistoryResult {
  const apiConfigured = isSwapApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const query = useQuery<SwapHistoryResult>({
    queryKey: ["swap-history", address, params],
    queryFn: () => getSwapHistory(address!, params),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const errorMessage = query.error
    ? query.error instanceof Error
      ? query.error.message
      : String(query.error)
    : undefined;

  return {
    data: query.data,
    isLoading: enabled && query.isPending,
    isError: query.isError,
    errorMessage,
    apiConfigured,
    refetch: query.refetch,
  };
}
