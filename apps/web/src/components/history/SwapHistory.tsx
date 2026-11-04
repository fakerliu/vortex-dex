"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowRight, ExternalLink, ReceiptText, Wallet } from "lucide-react";
import { useSwapHistory } from "@/hooks/useSwapHistory";
import { getTokenByAddress } from "@/config/tokens";
import { formatTokenAmount, truncateAddress } from "@/utils/format";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenIcon } from "@/components/token/TokenIcon";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { PageContainer } from "@/components/layout/PageContainer";
import type { SwapHistoryRecord } from "@/types/history";

const PAGE_SIZE = 20;

interface StatusMeta {
  label: string;
  variant: BadgeVariant;
}

function humanize(status: string): string {
  const words = status.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusMeta(status: string): StatusMeta {
  switch (status) {
    case "CONFIRMED":
      return { label: "Confirmed", variant: "success" };
    case "FAILED":
    case "REVERTED":
      return { label: "Failed", variant: "error" };
    case "PENDING":
      return { label: "Pending", variant: "warning" };
    case "CREATED":
    case "QUOTED":
    case "APPROVAL_REQUIRED":
    case "APPROVED":
      return { label: "In progress", variant: "info" };
    default:
      return { label: humanize(status), variant: "neutral" };
  }
}

/** 最小单位字符串 -> 人类可读；token 未收录时原样返回原始字符串（仍为字符串，无 Float）。 */
function formatRecordAmount(
  record: SwapHistoryRecord,
  side: "in" | "out",
): string {
  const address = side === "in" ? record.tokenIn : record.tokenOut;
  const raw = side === "in" ? record.amountIn : record.amountOut;
  const token = getTokenByAddress(address, record.chainId);
  return token ? formatTokenAmount(raw, token.decimals) : raw;
}

function symbolFor(address: string, chainId: number): string {
  return getTokenByAddress(address, chainId)?.symbol ?? truncateAddress(address);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HistoryRow({ record }: { record: SwapHistoryRecord }) {
  const meta = statusMeta(record.status);
  const tokenIn = getTokenByAddress(record.tokenIn, record.chainId);
  const tokenOut = getTokenByAddress(record.tokenOut, record.chainId);
  const inSymbol = symbolFor(record.tokenIn, record.chainId);
  const outSymbol = symbolFor(record.tokenOut, record.chainId);

  return (
    <li className="group relative border-b border-gray-100 py-4 transition-colors last:border-b-0 hover:bg-gray-50">
      <Link
        href={`/transactions/${record.id}`}
        className="absolute inset-0 z-0"
        aria-label={`View details: ${inSymbol} to ${outSymbol}`}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <TokenIcon
              logoURI={tokenIn?.logoURI}
              symbol={inSymbol}
              size={28}
            />
            <TokenIcon
              logoURI={tokenOut?.logoURI}
              symbol={outSymbol}
              size={28}
              className="-ml-2 border-2 border-white"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <span>{inSymbol}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              <span>{outSymbol}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
              <a
                href={record.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative z-10 flex items-center gap-1 font-mono text-gray-500 transition-colors hover:text-accent-500"
              >
                {truncateAddress(record.txHash, 6)}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              <span aria-hidden>·</span>
              <time dateTime={record.timestamp}>{formatTime(record.timestamp)}</time>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
          <div className="text-right text-sm tabular-nums">
            <div className="text-gray-500">
              −{formatRecordAmount(record, "in")} {inSymbol}
            </div>
            <div className="font-medium text-gray-900">
              +{formatRecordAmount(record, "out")} {outSymbol}
            </div>
          </div>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
      </div>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="-ml-2 h-7 w-7 rounded-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SwapHistory() {
  const { address, isConnected } = useAccount();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    useSwapHistory(address, { page, limit: PAGE_SIZE });

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / PAGE_SIZE))
    : 1;

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Transaction History
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Your confirmed and pending swaps on Base.
          </p>
        </div>

        {!isConnected || !address ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Connect your wallet"
            description="Connect a wallet to view your swap history."
            action={<WalletConnectButton />}
          />
        ) : !apiConfigured ? (
          <EmptyState
            icon={<ReceiptText className="h-8 w-8" />}
            title="History service not connected"
            description="The transaction history backend is not configured yet."
          />
        ) : isError ? (
          <EmptyState
            icon={<ReceiptText className="h-8 w-8" />}
            title="Failed to load history"
            description={errorMessage ?? "Something went wrong."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : isLoading && !data ? (
          <Card>
            <HistorySkeleton />
          </Card>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="h-8 w-8" />}
            title="No transactions yet"
            description="Once you complete a swap, it will appear here."
          />
        ) : (
          <Card className="p-4">
            <ul>
              {data.items.map((record) => (
                <HistoryRow key={record.id} record={record} />
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
              <Button
                variant="secondary"
                size="small"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-gray-500 tabular-nums">
                Page {data.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="small"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
