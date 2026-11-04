"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import type { Quote } from "@/types/quote";
import type { Token } from "@/types/token";
import {
  formatAmount,
  formatDecimalString,
  formatTokenAmount,
  priceImpactToPercent,
} from "@/utils/format";

function DetailRow({
  label,
  value,
  loading,
}: {
  label: string;
  value?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      {loading ? (
        <Skeleton className="h-4 w-24" />
      ) : (
        <span className="font-medium text-gray-800 tabular-nums">
          {value ?? "—"}
        </span>
      )}
    </div>
  );
}

export function QuoteDetails({
  quote,
  loading,
  hasAmount,
  notAvailable,
  errorMessage,
  tokenInSymbol,
  tokenOut,
}: {
  quote?: Quote;
  loading: boolean;
  hasAmount: boolean;
  notAvailable: boolean;
  errorMessage?: string;
  tokenInSymbol: string;
  tokenOut: Token;
}) {
  const showSkeleton = loading && hasAmount;

  // 后端返回人读价格 price（tokenOut 兑 tokenIn），限制小数位展示。
  const exchangeRate = quote
    ? `1 ${tokenInSymbol} = ${formatDecimalString(quote.price)} ${tokenOut.symbol}`
    : undefined;

  const minimumReceived = quote
    ? `${formatTokenAmount(quote.minimumReceived, tokenOut.decimals)} ${tokenOut.symbol}`
    : undefined;

  const bestRoute = quote
    ? `${quote.protocolName || quote.protocol || "Unknown"}${
        quote.route.length > 1 ? ` · ${quote.route.length} hops` : ""
      }`
    : undefined;

  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <DetailRow label="Exchange Rate" value={exchangeRate} loading={showSkeleton} />
      <DetailRow
        label="Price Impact"
        value={quote ? `${priceImpactToPercent(quote.priceImpact)}%` : undefined}
        loading={showSkeleton}
      />
      <DetailRow
        label="Minimum Received"
        value={minimumReceived}
        loading={showSkeleton}
      />
      <DetailRow
        label="Network Fee"
        value={quote ? `~${formatAmount(quote.gasEstimate)} gas` : undefined}
        loading={showSkeleton}
      />
      <DetailRow
        label="Protocol Fee"
        value={
          quote ? `${priceImpactToPercent(quote.swapFeeFraction, 6)}%` : undefined
        }
        loading={showSkeleton}
      />
      <DetailRow label="Best Route" value={bestRoute} loading={showSkeleton} />

      {notAvailable && (
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          Quote engine not connected yet — these details will populate once the
          backend is available.
        </p>
      )}

      {!notAvailable && errorMessage && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
