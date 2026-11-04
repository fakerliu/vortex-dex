"use client";

import { useAccount } from "wagmi";
import { Wallet } from "lucide-react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { isSupportedChain } from "@/config/chains";
import { BASE_CHAIN_ID } from "@/config/tokens";
import { formatDecimalString, formatUsd, truncateAddress } from "@/utils/format";
import { AuthenticityBadge } from "@/components/market/AuthenticityBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenIcon } from "@/components/token/TokenIcon";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { PageContainer } from "@/components/layout/PageContainer";
import type { PortfolioTokenDto } from "@/types/portfolio";

/**
 * 余额十进制字符串的展示格式化（纯字符串，无 Float）：
 * - 整数部分非 0：保留 4 位小数；
 * - 极小值：保留到首个非零位后 4 位（最多 10 位小数），避免尘埃余额被抹平为 0。
 */
function formatBalance(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const abs = value.startsWith("-") ? value.slice(1) : value;
  const [intPart, fracPart = ""] = abs.split(".");
  if (intPart !== "0") {
    return formatDecimalString(value, 4);
  }
  const firstNonZero = fracPart.search(/[1-9]/);
  const maxDigits = firstNonZero === -1 ? 2 : Math.min(10, firstNonZero + 4);
  return formatDecimalString(value, maxDigits);
}

function PortfolioRow({ item }: { item: PortfolioTokenDto }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <TokenIcon
          logoURI={item.logoURI ?? undefined}
          symbol={item.symbol}
          size={36}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">
            {item.symbol}
          </div>
          <div className="truncate text-xs text-gray-500">{item.name}</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <div className="text-sm text-gray-900 tabular-nums">
            {formatBalance(item.balanceFormatted)} {item.symbol}
          </div>
          <div className="text-xs text-gray-500 tabular-nums">
            {formatUsd(item.priceUsd)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-gray-900 tabular-nums">
            {formatUsd(item.valueUsd)}
          </div>
          <AuthenticityBadge authenticity={item.authenticity} />
        </div>
      </div>
    </li>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-28 w-full" />
      <Card className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function PortfolioView() {
  const { address, isConnected, chainId } = useAccount();
  const resolvedChainId = isSupportedChain(chainId) ? chainId! : BASE_CHAIN_ID;

  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    usePortfolio(address, resolvedChainId);

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Portfolio
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Your token balances and USD value on Base.
          </p>
        </div>

        {!isConnected || !address ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Connect your wallet"
            description="Connect a wallet to view your token balances and total value."
            action={<WalletConnectButton />}
          />
        ) : !apiConfigured ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Portfolio service not connected"
            description="The portfolio backend is not configured yet."
          />
        ) : isError ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Failed to load portfolio"
            description={errorMessage ?? "Something went wrong."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : isLoading && !data ? (
          <PortfolioSkeleton />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="No assets yet"
            description="Once this wallet holds tokens on Base, they will appear here."
          />
        ) : (
          <>
            <Card className="bg-gray-950 text-white">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Total Balance
              </div>
              <div className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                {formatUsd(data.totalValueUsd)}
              </div>
              <div className="mt-1.5 text-sm text-gray-400 tabular-nums">
                {data.items.length} asset{data.items.length === 1 ? "" : "s"} ·{" "}
                {truncateAddress(data.address)}
              </div>
            </Card>

            <Card className="p-4">
              <ul className="divide-y divide-gray-100">
                {data.items.map((item) => (
                  <PortfolioRow
                    key={`${item.chainId}-${item.address}`}
                    item={item}
                  />
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </PageContainer>
  );
}
