"use client";

import { useQuery } from "@tanstack/react-query";
import type { TokenSecurityDto } from "@/types/security";
import {
  fetchTokenSecurity,
  isSecurityApiConfigured,
} from "@/services/security";

export interface UseTokenSecurityResult {
  data: TokenSecurityDto | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案。 */
  errorMessage?: string;
  /** 后端 API 是否已配置。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * Token 安全信息（TanStack Query 封装）。
 * - 未配置 API 地址或未提供 token 地址时不发起请求。
 */
export function useTokenSecurity(
  address: string | undefined,
  chainId: number,
): UseTokenSecurityResult {
  const apiConfigured = isSecurityApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const query = useQuery<TokenSecurityDto>({
    queryKey: ["token-security", chainId, address],
    queryFn: () => fetchTokenSecurity(chainId, address!),
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
