"use client";

import { useQuery } from "@tanstack/react-query";
import type { ApprovalListResult } from "@/types/approval";
import { fetchApprovals, isApprovalApiConfigured } from "@/services/approval";

export interface UseApprovalsResult {
  data: ApprovalListResult | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 后端错误码已映射为可读文案。 */
  errorMessage?: string;
  /** 后端 API 是否已配置（未配置时前端明确显示「待接入」，不发请求）。 */
  apiConfigured: boolean;
  refetch: () => void;
}

/**
 * 钱包授权列表（TanStack Query 封装）。
 * - 未配置 API 地址或未提供钱包地址时不发起请求。
 */
export function useApprovals(
  address: string | undefined,
  chainId: number,
): UseApprovalsResult {
  const apiConfigured = isApprovalApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const query = useQuery<ApprovalListResult>({
    queryKey: ["approvals", address, chainId],
    queryFn: () => fetchApprovals(address!, chainId),
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
