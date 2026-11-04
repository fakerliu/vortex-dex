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
  /** 报价引擎是否已配置（未配置时前端明确显示「待接入」，不发请求） */
  apiConfigured: boolean;
  /** 报价引擎未接入（区别于普通网络错误） */
  notAvailable: boolean;
}

/**
 * 报价查询封装（TanStack Query）。
 * Phase 1：报价引擎未配置时不发起请求，UI 显示「待接入」。
 */
export function useQuote(params: QuoteParams | null): UseQuoteResult {
  const apiConfigured = isQuoteApiConfigured();
  const hasAmount = Boolean(params && params.inputAmount !== "0");

  const query = useQuery<Quote>({
    queryKey: ["quote", params],
    queryFn: () => fetchQuote(params!),
    enabled: apiConfigured && hasAmount && Boolean(params),
    retry: false,
  });

  const notAvailable =
    hasAmount &&
    (!apiConfigured || query.error instanceof QuoteNotAvailableError);

  return {
    quote: query.data,
    isLoading: apiConfigured && hasAmount && query.isPending,
    isError: query.isError,
    apiConfigured,
    notAvailable,
  };
}
