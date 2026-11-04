"use client";

import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import { usePoolDetail } from "@/hooks/usePoolDetail";
import { formatAmount, formatFeePpm, formatTokenAmount, truncateAddress } from "@/utils/format";
import { AuthenticityBadge } from "@/components/market/AuthenticityBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageContainer } from "@/components/layout/PageContainer";
import type { PoolTokenRef } from "@/types/pool";

function symbolFor(token: PoolTokenRef): string {
  return token.symbol ?? truncateAddress(token.address);
}

/** 原始大整数储备量 -> 人类可读：有 decimals 按精度对齐，否则原样加千分位。 */
function formatReserve(raw: string, decimals: number | null): string {
  if (decimals === null || decimals === undefined) {
    return formatAmount(raw);
  }
  return formatTokenAmount(raw, decimals);
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{children}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function PoolDetailView({ id }: { id: string }) {
  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    usePoolDetail(id);

  const token0Symbol = data ? symbolFor(data.token0) : "";
  const token1Symbol = data ? symbolFor(data.token1) : "";

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <Link
            href="/pools"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-accent-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Pools
          </Link>
        </div>

        {!apiConfigured ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="Pool explorer not connected"
            description="The pool explorer backend is not configured yet."
          />
        ) : isLoading ? (
          <Card>
            <DetailSkeleton />
          </Card>
        ) : isError || !data ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="Failed to load pool"
            description={errorMessage ?? "Pool not found."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            <Card className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-bold tracking-tight text-gray-950 md:text-2xl">
                    {token0Symbol}
                    <span className="mx-1 text-gray-400">/</span>
                    {token1Symbol}
                  </h1>
                  <Badge variant="neutral" className="px-2 py-0.5 text-xs">
                    {data.protocolType}
                  </Badge>
                </div>
                <div className="truncate text-sm text-gray-500">
                  {data.protocolName} · {truncateAddress(data.poolAddress, 6)}
                </div>
              </div>
              <AuthenticityBadge authenticity={data.authenticity} />
            </Card>

            <Card>
              <div className="divide-y divide-gray-100">
                <DetailRow label="Fee">{formatFeePpm(data.fee)}</DetailRow>
                <DetailRow label="Liquidity (raw)">
                  {formatAmount(data.liquidity)}
                </DetailRow>
                <DetailRow label={`Reserve ${token0Symbol}`}>
                  {formatReserve(data.reserve0, data.token0.decimals)}
                </DetailRow>
                <DetailRow label={`Reserve ${token1Symbol}`}>
                  {formatReserve(data.reserve1, data.token1.decimals)}
                </DetailRow>
                <DetailRow label="Last synced block">
                  {data.lastSyncedBlock}
                </DetailRow>
                <DetailRow label="Pool address">
                  <span className="break-all font-mono text-xs">
                    {data.poolAddress}
                  </span>
                </DetailRow>
              </div>
            </Card>

            <Card className="p-0">
              <div className="border-b border-gray-100 px-5 py-3 text-xs font-medium uppercase tracking-wide text-gray-400">
                Reserve history
              </div>
              {data.snapshots.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-500">
                  No snapshots recorded yet.
                </div>
              ) : (
                <ul className="max-h-80 divide-y divide-gray-100 overflow-auto">
                  {data.snapshots.map((snap) => (
                    <li
                      key={snap.blockNumber}
                      className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-5 py-2.5 text-sm"
                    >
                      <span className="font-medium text-gray-500 tabular-nums">
                        #{snap.blockNumber}
                      </span>
                      <span className="truncate text-right tabular-nums text-gray-900">
                        {formatReserve(snap.reserve0, data.token0.decimals)}
                      </span>
                      <span className="truncate text-right tabular-nums text-gray-900">
                        {formatReserve(snap.reserve1, data.token1.decimals)}
                      </span>
                      <span className="truncate text-right tabular-nums text-gray-500">
                        {formatAmount(snap.liquidity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
