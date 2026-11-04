"use client";

import { useQuery } from "@tanstack/react-query";
import type { PoolListResult } from "@/types/pool";
import { fetchPools, isPoolApiConfigured } from "@/services/pool";

export interface UsePoolsResult {
  data: PoolListResult | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案。 */
  errorMessage?: string;
  /** 后端 API 是否已配置（未配置时前端明确显示「待接入」，不发请求）。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * 池列表（TanStack Query 封装）。
 * 未配置 API 地址时不发起请求。
 */
export function usePools(
  chainId: number,
  page = 1,
  limit = 20,
): UsePoolsResult {
  const apiConfigured = isPoolApiConfigured();

  const query = useQuery<PoolListResult>({
    queryKey: ["pools", chainId, page, limit],
    queryFn: () => fetchPools(chainId, page, limit),
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
