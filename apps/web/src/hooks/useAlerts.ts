"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CheckAlertsResult,
  CreateAlertParams,
  PriceAlert,
  UpdateAlertParams,
} from "@/types/alerts";
import {
  checkAlerts,
  createAlert,
  deleteAlert,
  isAlertsApiConfigured,
  listAlerts,
  updateAlert,
} from "@/services/alerts";

export interface UseAlertsResult {
  data: PriceAlert[] | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  apiConfigured: boolean;
  refetch: () => void;
  create: (params: CreateAlertParams) => Promise<PriceAlert>;
  createPending: boolean;
  update: (id: string, params: UpdateAlertParams) => Promise<PriceAlert>;
  updatePending: boolean;
  remove: (id: string) => Promise<void>;
  removePending: boolean;
  runCheck: () => Promise<CheckAlertsResult>;
  checkPending: boolean;
  /** 最近一次「检查提醒」的命中结果。 */
  checkResult: CheckAlertsResult | undefined;
}

/**
 * 价格提醒（TanStack Query 封装）。
 * - 未配置 API 地址或未提供钱包地址时不发起列表请求；
 * - create/update/remove/check 成功后自动失效并重取列表。
 */
export function useAlerts(address: string | undefined): UseAlertsResult {
  const queryClient = useQueryClient();
  const apiConfigured = isAlertsApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const query = useQuery<PriceAlert[]>({
    queryKey: ["alerts", address],
    queryFn: () => listAlerts(address!),
    enabled,
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["alerts", address] });

  const create = useMutation({
    mutationFn: (params: CreateAlertParams) => createAlert(params),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateAlertParams }) =>
      updateAlert(id, params),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAlert(id),
    onSuccess: invalidate,
  });

  const check = useMutation({
    mutationFn: () => checkAlerts(),
    onSuccess: invalidate,
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
    create: (params) => create.mutateAsync(params),
    createPending: create.isPending,
    update: (id, params) => update.mutateAsync({ id, params }),
    updatePending: update.isPending,
    remove: (id) => remove.mutateAsync(id),
    removePending: remove.isPending,
    runCheck: () => check.mutateAsync(),
    checkPending: check.isPending,
    checkResult: check.data,
  };
}
