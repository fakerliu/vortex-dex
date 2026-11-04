"use client";

import { useQuery } from "@tanstack/react-query";
import type { PortfolioDto } from "@/types/portfolio";
import { fetchPortfolio, isPortfolioApiConfigured } from "@/services/portfolio";

export interface UsePortfolioResult {
  data: PortfolioDto | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案。 */
  errorMessage?: string;
  /** 后端 API 是否已配置（未配置时前端明确显示「待接入」，不发请求）。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * 用户资产组合（TanStack Query 封装）。
 * - 未配置 API 地址或未提供钱包地址时不发起请求。
 */
export function usePortfolio(
  address: string | undefined,
  chainId: number,
): UsePortfolioResult {
  const apiConfigured = isPortfolioApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const query = useQuery<PortfolioDto>({
    queryKey: ["portfolio", address, chainId],
    queryFn: () => fetchPortfolio(address!, chainId),
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
