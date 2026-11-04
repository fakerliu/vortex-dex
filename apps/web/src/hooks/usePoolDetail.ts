"use client";

import { useQuery } from "@tanstack/react-query";
import type { PoolDetail } from "@/types/pool";
import { fetchPoolDetail, isPoolApiConfigured } from "@/services/pool";

export interface UsePoolDetailResult {
  data: PoolDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案（NOT_FOUND 时即「池不存在」）。 */
  errorMessage?: string;
  /** 后端 API 是否已配置。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * 单池详情（TanStack Query 封装）。
 * id 为 pool 记录 id。
 */
export function usePoolDetail(id: string | undefined): UsePoolDetailResult {
  const apiConfigured = isPoolApiConfigured();
  const enabled = apiConfigured && Boolean(id);

  const query = useQuery<PoolDetail>({
    queryKey: ["pool-detail", id],
    queryFn: () => fetchPoolDetail(id!),
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
