"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@/types/notifications";
import {
  isNotificationsApiConfigured,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "@/services/notifications";

export interface UseNotificationsResult {
  /** 通知列表（未读优先 + created_at 降序）。 */
  data: Notification[] | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  apiConfigured: boolean;
  refetch: () => void;
  /** 未读数（供顶栏角标）。 */
  unreadCount: number | undefined;
  unreadLoading: boolean;
  markRead: (id: string) => Promise<void>;
  markReadPending: boolean;
  markAllRead: () => Promise<void>;
  markAllReadPending: boolean;
}

/**
 * 站内通知（TanStack Query 封装）。
 * - 未配置 API 地址或未提供钱包地址时不发起请求；
 * - markRead / markAllRead 成功后自动失效列表与未读数。
 */
export function useNotifications(
  address: string | undefined,
): UseNotificationsResult {
  const queryClient = useQueryClient();
  const apiConfigured = isNotificationsApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const listQuery = useQuery<Notification[]>({
    queryKey: ["notifications", address],
    queryFn: () => listNotifications(address!),
    enabled,
    retry: false,
  });

  const unreadQuery = useQuery<number>({
    queryKey: ["notifications-unread", address],
    queryFn: async () => (await unreadCount(address!)).count,
    enabled,
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications", address] });
    queryClient.invalidateQueries({
      queryKey: ["notifications-unread", address],
    });
  };

  const read = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: invalidate,
  });

  const readAll = useMutation({
    mutationFn: () => markAllRead(address!),
    onSuccess: invalidate,
  });

  const errorMessage = listQuery.error
    ? listQuery.error instanceof Error
      ? listQuery.error.message
      : String(listQuery.error)
    : undefined;

  return {
    data: listQuery.data,
    isLoading: enabled && listQuery.isPending,
    isError: listQuery.isError,
    errorMessage,
    apiConfigured,
    refetch: listQuery.refetch,
    unreadCount: unreadQuery.data,
    unreadLoading: enabled && unreadQuery.isPending,
    markRead: (id) => read.mutateAsync(id),
    markReadPending: read.isPending,
    markAllRead: () => readAll.mutateAsync(),
    markAllReadPending: readAll.isPending,
  };
}
