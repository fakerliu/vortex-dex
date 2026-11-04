"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMarketRanking } from "@/hooks/useMarketRanking";
import { BASE_CHAIN_ID } from "@/config/tokens";
import { formatUsd, truncateAddress } from "@/utils/format";
import { AuthenticityBadge } from "./AuthenticityBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenIcon } from "@/components/token/TokenIcon";
import { PageContainer } from "@/components/layout/PageContainer";
import type { MarketRankingItem } from "@/types/market";

function symbolFor(item: MarketRankingItem): string {
  return item.symbol ?? truncateAddress(item.address);
}

function ExploreRow({ item, rank }: { item: MarketRankingItem; rank: number }) {
  const symbol = symbolFor(item);
  const name = item.name ?? symbol;

  return (
    <li>
      <Link
        href={`/token/${item.address}`}
        className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 sm:grid-cols-[2rem_minmax(0,1fr)_7rem_7rem] sm:gap-4 sm:px-5"
      >
        <span className="w-6 text-right text-sm font-medium text-gray-400 tabular-nums">
          {rank}
        </span>

        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon logoURI={item.logoURI ?? undefined} symbol={symbol} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-gray-900">
                {symbol}
              </span>
              {item.verified && (
                <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                  Verified
                </Badge>
              )}
              {item.risk && (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                  Risk
                </Badge>
              )}
            </div>
            <div className="truncate text-xs text-gray-500">{name}</div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="text-sm font-medium text-gray-900 tabular-nums">
            {formatUsd(item.priceUsd)}
          </span>
          <AuthenticityBadge authenticity={item.authenticity} />
        </div>

        <div className="hidden flex-col items-end gap-1 sm:flex">
          <span className="text-sm font-medium text-gray-900 tabular-nums">
            {formatUsd(item.volumeUsd)}
          </span>
          <AuthenticityBadge authenticity={item.volumeAuthenticity} />
        </div>
      </Link>
    </li>
  );
}

function ExploreSkeleton() {
  return (
    <div className="space-y-1 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2.5">
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ExploreView() {
  const chainId = BASE_CHAIN_ID;
  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    useMarketRanking(chainId);

  const items = data?.items ?? [];

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Explore
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            On-chain token prices and volume with data authenticity markers.
          </p>
        </div>

        {!apiConfigured ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Market data not connected"
            description="The market data backend is not configured yet. Prices will appear once the API is connected."
          />
        ) : isError ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Failed to load market data"
            description={errorMessage ?? "Something went wrong."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : isLoading && !data ? (
          <Card className="p-0">
            <ExploreSkeleton />
          </Card>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No tokens available"
            description="No market data is available for this chain yet."
          />
        ) : (
          <Card className="p-0">
            <div className="hidden grid-cols-[2rem_minmax(0,1fr)_7rem_7rem] gap-4 border-b border-gray-100 px-5 py-3 text-xs font-medium uppercase tracking-wide text-gray-400 sm:grid">
              <span>#</span>
              <span>Token</span>
              <span className="text-right">Price</span>
              <span className="text-right">Volume (24h)</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {items.map((item, i) => (
                <ExploreRow key={item.address} item={item} rank={i + 1} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
