"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import { usePools } from "@/hooks/usePools";
import { BASE_CHAIN_ID } from "@/config/tokens";
import { formatAmount, formatFeePpm, truncateAddress } from "@/utils/format";
import { AuthenticityBadge } from "@/components/market/AuthenticityBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageContainer } from "@/components/layout/PageContainer";
import type { PoolListItem, PoolTokenRef } from "@/types/pool";

function symbolFor(token: PoolTokenRef): string {
  return token.symbol ?? truncateAddress(token.address);
}

function PoolRow({ item }: { item: PoolListItem }) {
  const token0Symbol = symbolFor(item.token0);
  const token1Symbol = symbolFor(item.token1);

  return (
    <li>
      <Link
        href={`/pools/${item.id}`}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_7rem] sm:gap-4 sm:px-5"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900">
              {token0Symbol}
              <span className="mx-1 text-gray-400">/</span>
              {token1Symbol}
            </span>
            <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">
              {item.protocolType}
            </Badge>
          </div>
          <div className="truncate text-xs text-gray-500">
            {item.protocolName} · {truncateAddress(item.poolAddress, 6)}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 sm:items-start">
          <span className="text-sm font-medium text-gray-900 tabular-nums">
            {formatFeePpm(item.fee)}
          </span>
          <span className="text-xs text-gray-400">Fee</span>
        </div>

        <div className="hidden flex-col items-end gap-1 sm:flex">
          <span className="text-sm font-medium text-gray-900 tabular-nums">
            {formatAmount(item.liquidity)}
          </span>
          <span className="text-xs text-gray-400">Liquidity</span>
        </div>

        <div className="flex justify-end">
          <AuthenticityBadge authenticity={item.authenticity} />
        </div>
      </Link>
    </li>
  );
}

function PoolListSkeleton() {
  return (
    <div className="space-y-1 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2.5">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function PoolListView() {
  const chainId = BASE_CHAIN_ID;
  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    usePools(chainId);

  const items = data?.items ?? [];

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Pools
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            On-chain liquidity pools discovered during quoting and routing.
          </p>
        </div>

        {!apiConfigured ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="Pool explorer not connected"
            description="The pool explorer backend is not configured yet. Pools will appear once the API is connected."
          />
        ) : isError ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="Failed to load pools"
            description={errorMessage ?? "Something went wrong."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : isLoading && !data ? (
          <Card className="p-0">
            <PoolListSkeleton />
          </Card>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="No pools available"
            description="No liquidity pools have been discovered on this chain yet. Pools are recorded on-chain when a quote or route is requested."
          />
        ) : (
          <Card className="p-0">
            <div className="hidden grid-cols-[minmax(0,1fr)_8rem_6rem_7rem] gap-4 border-b border-gray-100 px-5 py-3 text-xs font-medium uppercase tracking-wide text-gray-400 sm:grid">
              <span>Pool</span>
              <span>Fee</span>
              <span className="text-right">Liquidity</span>
              <span className="text-right">Authenticity</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {items.map((item) => (
                <PoolRow key={item.id} item={item} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
