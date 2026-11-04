"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import type { Quote } from "@/types/quote";

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
}: {
  quote?: Quote;
  loading: boolean;
  hasAmount: boolean;
  notAvailable: boolean;
}) {
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <DetailRow
        label="Exchange Rate"
        value={quote?.exchangeRate}
        loading={loading && hasAmount}
      />
      <DetailRow
        label="Price Impact"
        value={quote ? `${quote.priceImpact}%` : undefined}
        loading={loading && hasAmount}
      />
      <DetailRow
        label="Network Fee"
        value={quote?.networkFee}
        loading={loading && hasAmount}
      />
      <DetailRow
        label="Protocol Fee"
        value={quote?.protocolFee}
        loading={loading && hasAmount}
      />
      <DetailRow
        label="Minimum Received"
        value={quote?.minimumReceived}
        loading={loading && hasAmount}
      />

      {notAvailable && (
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          Quote engine not connected yet — these details will populate once the
          backend is available.
        </p>
      )}
    </div>
  );
}
