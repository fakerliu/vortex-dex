"use client";

import { useQuery } from "@tanstack/react-query";
import type { Quote, QuoteParams } from "@/types/quote";
import {
  fetchQuote,
  isQuoteApiConfigured,
  QuoteNotAvailableError,
} from "@/services/quote";

export interface UseQuoteResult {
  quote: Quote | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 报价引擎是否已配置（未配置时前端明确显示「待接入」，不发请求）。 */
  apiConfigured: boolean;
  /** 报价引擎未接入（区别于普通网络/业务错误）。 */
  notAvailable: boolean;
  /** 报价失败的提示文案（业务错误码已映射为可读文案）。 */
  errorMessage?: string;
}

/**
 * 报价查询封装（TanStack Query）。
 * - 未配置 API 地址时不发起请求，UI 显示「待接入」。
 * - 金额以最小单位字符串比较，避免浮点参与判断。
 */
export function useQuote(params: QuoteParams | null): UseQuoteResult {
  const apiConfigured = isQuoteApiConfigured();
  const hasAmount = Boolean(params && params.amountIn !== "0");

  const query = useQuery<Quote>({
    queryKey: ["quote", params],
    queryFn: () => fetchQuote(params!),
    enabled: apiConfigured && hasAmount && Boolean(params),
    retry: false,
    staleTime: 10_000,
    refetchInterval: false,
  });

  const notAvailable =
    hasAmount &&
    (!apiConfigured || query.error instanceof QuoteNotAvailableError);

  const errorMessage = query.error
    ? query.error instanceof Error
      ? query.error.message
      : String(query.error)
    : undefined;

  return {
    quote: query.data,
    isLoading: apiConfigured && hasAmount && query.isPending,
    isError: query.isError,
    apiConfigured,
    notAvailable,
    errorMessage,
  };
}
