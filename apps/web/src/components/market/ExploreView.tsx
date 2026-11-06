"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMarketRanking } from "@/hooks/useMarketRanking";
import { BASE_CHAIN_ID } from "@/config/tokens";
import { cn } from "@/utils/cn";
import { formatUsd, truncateAddress } from "@/utils/format";
import { AuthenticityBadge } from "./AuthenticityBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenIcon } from "@/components/token/TokenIcon";
import { PageContainer } from "@/components/layout/PageContainer";
import type { MarketRankingItem, MarketRankingSortBy } from "@/types/market";

/** 与后端 DEFAULT_LIMIT 保持一致（后端上限 100）。 */
const PAGE_SIZE = 20;

const SORT_OPTIONS: { value: MarketRankingSortBy; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "volume", label: "Volume" },
  { value: "price_change", label: "24h Change" },
];

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

function FilterToggle({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex items-center gap-2"
    >
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent-500" : "bg-gray-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="text-sm font-medium text-gray-600">{label}</span>
    </button>
  );
}

export function ExploreView() {
  const chainId = BASE_CHAIN_ID;
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sortBy, setSortBy] = useState<MarketRankingSortBy>("price");
  const [page, setPage] = useState(1);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [withPriceOnly, setWithPriceOnly] = useState(false);

  // 300ms 防抖：输入变化后延迟触发后端搜索，避免每个字符都发请求。
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isFetching, isError, errorMessage, apiConfigured, refetch } =
    useMarketRanking(chainId, sortBy, PAGE_SIZE, debouncedQ, page);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 筛选为前端本地过滤（后端 items 已含 verified / priceUsd）。
  // 保留原始 index 以便跨页时排名连续。
  const visible = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (verifiedOnly && !item.verified) return false;
      if (withPriceOnly && (item.priceUsd == null || item.priceUsd === "")) {
        return false;
      }
      return true;
    });

  const hasSearch = debouncedQ.length > 0;
  const hasFilters = verifiedOnly || withPriceOnly;

  const emptyTitle = hasSearch
    ? "No results"
    : hasFilters
      ? "No matching tokens"
      : "No tokens available";
  const emptyDescription = hasSearch
    ? "No tokens match your search."
    : hasFilters
      ? "No tokens match your filters."
      : "No market data is available for this chain yet.";

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

        <div className="flex flex-col gap-3">
          <Input
            startAdornment={<Search className="h-4 w-4" />}
            placeholder="Search token name or symbol"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            aria-label="Search token name or symbol"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSortBy(opt.value);
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    sortBy === opt.value
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-800",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <FilterToggle
                checked={verifiedOnly}
                onToggle={() => setVerifiedOnly((v) => !v)}
                label="Verified only"
              />
              <FilterToggle
                checked={withPriceOnly}
                onToggle={() => setWithPriceOnly((v) => !v)}
                label="With price"
              />
            </div>
          </div>
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
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <Card className={cn("p-0 transition-opacity", isFetching && "opacity-60")}>
            <div className="hidden grid-cols-[2rem_minmax(0,1fr)_7rem_7rem] gap-4 border-b border-gray-100 px-5 py-3 text-xs font-medium uppercase tracking-wide text-gray-400 sm:grid">
              <span>#</span>
              <span>Token</span>
              <span className="text-right">Price</span>
              <span className="text-right">Volume (24h)</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {visible.map(({ item, index }) => (
                <ExploreRow
                  key={item.address}
                  item={item}
                  rank={(page - 1) * PAGE_SIZE + index + 1}
                />
              ))}
            </ul>
          </Card>
        )}

        {data && total > 0 && (
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="small"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Previous
            </Button>
            <span className="text-sm text-gray-500 tabular-nums">
              Page {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
