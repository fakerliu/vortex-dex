"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddFavoriteParams,
  UpdatePreferenceParams,
  UserPreference,
} from "@/types/preferences";
import {
  addFavorite,
  getPreference,
  isPreferencesApiConfigured,
  removeFavorite,
  updatePreference,
} from "@/services/preferences";

export interface UsePreferencesResult {
  data: UserPreference | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  apiConfigured: boolean;
  refetch: () => void;
  update: (params: UpdatePreferenceParams) => Promise<UserPreference>;
  updatePending: boolean;
  addFavorite: (params: AddFavoriteParams) => Promise<UserPreference>;
  addFavoritePending: boolean;
  removeFavorite: (tokenAddress: string) => Promise<UserPreference>;
  removeFavoritePending: boolean;
}

/**
 * 用户偏好（TanStack Query 封装）。
 * - 未配置 API 地址或未提供钱包地址时不发起请求；
 * - update/addFavorite/removeFavorite 成功后写回最新偏好数据（后端均返回完整 UserPreferenceDto）。
 */
export function usePreferences(
  address: string | undefined,
): UsePreferencesResult {
  const queryClient = useQueryClient();
  const apiConfigured = isPreferencesApiConfigured();
  const enabled = apiConfigured && Boolean(address);

  const query = useQuery<UserPreference>({
    queryKey: ["preferences", address],
    queryFn: () => getPreference(address!),
    enabled,
    retry: false,
  });

  const apply = (pref: UserPreference) => {
    queryClient.setQueryData(["preferences", address], pref);
  };

  const update = useMutation({
    mutationFn: (params: UpdatePreferenceParams) =>
      updatePreference(address!, params),
    onSuccess: apply,
  });

  const addFav = useMutation({
    mutationFn: (params: AddFavoriteParams) => addFavorite(address!, params),
    onSuccess: apply,
  });

  const removeFav = useMutation({
    mutationFn: (tokenAddress: string) =>
      removeFavorite(address!, tokenAddress),
    onSuccess: apply,
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
    update: (params) => update.mutateAsync(params),
    updatePending: update.isPending,
    addFavorite: (params) => addFav.mutateAsync(params),
    addFavoritePending: addFav.isPending,
    removeFavorite: (tokenAddress) => removeFav.mutateAsync(tokenAddress),
    removeFavoritePending: removeFav.isPending,
  };
}
