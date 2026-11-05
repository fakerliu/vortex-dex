"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LimitOrderDto,
  LimitOrderListParams,
  LimitOrderListResult,
} from "@/types/limit-order";
import {
  cancelLimitOrder,
  isLimitOrderApiConfigured,
  listLimitOrders,
} from "@/services/limit-order";

export interface UseLimitOrdersResult {
  data: LimitOrderListResult | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  apiConfigured: boolean;
  refetch: () => void;
  cancel: (id: string) => Promise<LimitOrderDto>;
  cancelPending: boolean;
}

/**
 * 限价单列表 + 撤单（TanStack Query 封装）。
 * - 未配置 API 地址或未提供钱包地址时不发起请求；
 * - 活跃单状态会被 keeper 异步改变，默认 15s 轮询刷新；
 * - 撤单成功后自动失效并重取列表。
 */
export function useLimitOrders(
  address: string | undefined,
  params: LimitOrderListParams = {},
): UseLimitOrdersResult {
  const queryClient = useQueryClient();
  const apiConfigured = isLimitOrderApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const query = useQuery<LimitOrderListResult>({
    queryKey: ["limit-orders", address, params],
    queryFn: () => listLimitOrders(address!, params),
    enabled,
    retry: false,
    refetchInterval: 15_000,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelLimitOrder(id, address!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["limit-orders", address] });
    },
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
    cancel: (id) => cancel.mutateAsync(id),
    cancelPending: cancel.isPending,
  };
}
