"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  ReceiptText,
} from "lucide-react";
import { useSwapDetail } from "@/hooks/useSwapDetail";
import { getTokenByAddress } from "@/config/tokens";
import { getExplorerUrl } from "@/config/chains";
import { formatTokenAmount, truncateAddress } from "@/utils/format";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenIcon } from "@/components/token/TokenIcon";
import { PageContainer } from "@/components/layout/PageContainer";
import type { SwapDetail } from "@/types/swap";

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

function symbolFor(address: string, chainId: number): string {
  return getTokenByAddress(address, chainId)?.symbol ?? truncateAddress(address);
}

function tokenFor(address: string, chainId: number) {
  return getTokenByAddress(address, chainId);
}

/** 最小单位字符串 -> 人类可读；token 未收录时原样返回原始字符串（无 Float）。 */
function formatRawAmount(
  amount: string,
  address: string,
  chainId: number,
): string {
  const token = getTokenByAddress(address, chainId);
  return token ? formatTokenAmount(amount, token.decimals) : amount;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
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

function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败。
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
      aria-label="Copy transaction hash"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-sm text-gray-500">{label}</span>
      <span className="text-right text-sm font-medium text-gray-900">
        {children}
      </span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function ChainEventsSection({ detail }: { detail: SwapDetail }) {
  if (detail.chainEvents.length === 0) return null;
  return (
    <Card>
      <div className="mb-2 text-sm font-semibold text-gray-900">
        Route / On-chain events
      </div>
      <ul className="divide-y divide-gray-100">
        {detail.chainEvents.map((ev) => (
          <li key={ev.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm text-gray-900">
                <span className="font-medium">
                  {ev.tokenIn
                    ? symbolFor(ev.tokenIn, detail.chainId)
                    : "?"}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                <span className="font-medium">
                  {ev.tokenOut
                    ? symbolFor(ev.tokenOut, detail.chainId)
                    : "?"}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-gray-500">
                {ev.protocolType ?? "unknown protocol"} ·{" "}
                {ev.pool ? (
                  <a
                    href={`${getExplorerUrl(detail.chainId)}/address/${ev.pool}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-gray-500 transition-colors hover:text-accent-500"
                  >
                    {truncateAddress(ev.pool)}
                  </a>
                ) : (
                  "unknown pool"
                )}
                {" · "}block {ev.blockNumber}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function TransactionDetailView({ id }: { id: string }) {
  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    useSwapDetail(id);

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <Link
            href="/transactions"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-accent-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Transactions
          </Link>
        </div>

        {!apiConfigured ? (
          <EmptyState
            icon={<ReceiptText className="h-8 w-8" />}
            title="Transaction service not connected"
            description="The transaction detail backend is not configured yet."
          />
        ) : isLoading ? (
          <Card>
            <DetailSkeleton />
          </Card>
        ) : isError || !data ? (
          <EmptyState
            icon={<ReceiptText className="h-8 w-8" />}
            title="Transaction not available"
            description={errorMessage ?? "Transaction not found."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-lg font-bold tracking-tight text-gray-950 md:text-xl">
                    Transaction
                  </h1>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="break-all font-mono text-sm text-gray-600 tabular-nums">
                      {data.txHash}
                    </span>
                    <a
                      href={data.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-gray-400 transition-colors hover:text-accent-500"
                      aria-label="View on block explorer"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                    <CopyTextButton text={data.txHash} />
                  </div>
                </div>
                <Badge variant={statusMeta(data.status).variant}>
                  {statusMeta(data.status).label}
                </Badge>
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <TokenIcon
                    logoURI={tokenFor(data.tokenIn, data.chainId)?.logoURI}
                    symbol={symbolFor(data.tokenIn, data.chainId)}
                    size={36}
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-gray-500">You paid</div>
                    <div className="truncate text-base font-semibold text-gray-900 tabular-nums">
                      {formatRawAmount(data.amountIn, data.tokenIn, data.chainId)}{" "}
                      {symbolFor(data.tokenIn, data.chainId)}
                    </div>
                  </div>
                </div>

                <ArrowRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />

                <div className="flex min-w-0 items-center gap-3">
                  <TokenIcon
                    logoURI={tokenFor(data.tokenOut, data.chainId)?.logoURI}
                    symbol={symbolFor(data.tokenOut, data.chainId)}
                    size={36}
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-gray-500">You received</div>
                    <div className="truncate text-base font-semibold text-gray-900 tabular-nums">
                      {formatRawAmount(data.amountOut, data.tokenOut, data.chainId)}{" "}
                      {symbolFor(data.tokenOut, data.chainId)}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="divide-y divide-gray-100">
                <DetailRow label="Status">
                  {statusMeta(data.status).label}
                </DetailRow>
                <DetailRow label="Block">
                  {data.blockNumber != null ? data.blockNumber : "—"}
                </DetailRow>
                <DetailRow label="Confirmed at">
                  {formatTime(data.confirmedAt)}
                </DetailRow>
                <DetailRow label="Created at">{formatTime(data.createdAt)}</DetailRow>
                <DetailRow label="Gas used">
                  {data.gasUsed != null ? `${data.gasUsed} gas` : "—"}
                </DetailRow>
                <DetailRow label="Effective gas price">
                  {data.effectiveGasPrice != null
                    ? `${formatTokenAmount(data.effectiveGasPrice, 9, 4)} gwei`
                    : "—"}
                </DetailRow>
                {data.failureReason && (
                  <DetailRow label="Failure reason">
                    <span className="text-danger">{data.failureReason}</span>
                  </DetailRow>
                )}
              </div>
            </Card>

            <ChainEventsSection detail={data} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
