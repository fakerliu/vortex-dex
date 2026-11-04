"use client";

import { useQuery } from "@tanstack/react-query";
import type { SwapDetail } from "@/types/swap";
import { getSwapDetail, isSwapApiConfigured } from "@/services/swap";

export interface UseSwapDetailResult {
  data: SwapDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案（NOT_FOUND 时即「交易不存在」）。 */
  errorMessage?: string;
  /** 后端 API 是否已配置。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * 单笔交易详情（TanStack Query 封装）。
 * id 为 swap 记录 id（非 txHash）。
 */
export function useSwapDetail(id: string | undefined): UseSwapDetailResult {
  const apiConfigured = isSwapApiConfigured();
  const enabled = apiConfigured && Boolean(id);

  const query = useQuery<SwapDetail>({
    queryKey: ["swap-detail", id],
    queryFn: () => getSwapDetail(id!),
    enabled,
    retry: false,
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
