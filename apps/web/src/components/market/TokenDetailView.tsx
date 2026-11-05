"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowLeft, Bell, Check, Copy, ExternalLink, Star } from "lucide-react";
import { useTokenDetail } from "@/hooks/useTokenDetail";
import { usePreferences } from "@/hooks/usePreferences";
import { getTokenByAddress } from "@/config/tokens";
import { getChain, getExplorerUrl } from "@/config/chains";
import { formatUsd, truncateAddress } from "@/utils/format";
import { AuthenticityBadge } from "./AuthenticityBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenIcon } from "@/components/token/TokenIcon";
import { TokenSecurityCard } from "@/components/security/TokenSecurityCard";
import { PageContainer } from "@/components/layout/PageContainer";

function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非安全上下文等）时静默失败，用户仍可手动选择复制。
    }
  }

  return (
    <Button variant="secondary" size="small" onClick={copy}>
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
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
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function TokenDetailView({
  address,
  chainId,
}: {
  address: string;
  chainId: number;
}) {
  const { token, price, isLoading, isError, errorMessage, apiConfigured, refetch } =
    useTokenDetail(address, chainId);

  const { address: userAddress, isConnected } = useAccount();
  const prefs = usePreferences(userAddress);

  const local = getTokenByAddress(address, chainId);
  const chain = getChain(chainId);
  const explorerUrl = getExplorerUrl(chainId);

  const symbol = token?.symbol ?? local?.symbol ?? truncateAddress(address);
  const name = token?.name ?? local?.name ?? symbol;
  const decimals = token?.decimals ?? local?.decimals;
  const logoURI = token?.logoURI ?? local?.logoURI;
  const verified = token?.verified ?? local?.verified ?? false;
  const risk = token?.risk ?? local?.risk ?? false;

  const isFavorite =
    prefs.data?.favoriteTokens.some(
      (t) => t.address.toLowerCase() === address.toLowerCase(),
    ) ?? false;

  const toggleFavorite = async () => {
    if (!userAddress) return;
    if (isFavorite) {
      await prefs.removeFavorite(address).catch(() => {});
    } else {
      await prefs.addFavorite({ chainId, address, symbol }).catch(() => {});
    }
  };

  const quoteSymbol = price?.quoteToken
    ? getTokenByAddress(price.quoteToken, price.chainId)?.symbol ??
      truncateAddress(price.quoteToken)
    : null;

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <Link
            href="/explore"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-accent-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Explore
          </Link>
        </div>

        {!apiConfigured ? (
          <EmptyState
            icon={<TokenIcon logoURI={logoURI} symbol={symbol} size={32} />}
            title="Market data not connected"
            description="The market data backend is not configured yet."
          />
        ) : isLoading ? (
          <Card>
            <DetailSkeleton />
          </Card>
        ) : isError && !token && !price ? (
          <EmptyState
            icon={<TokenIcon logoURI={logoURI} symbol={symbol} size={32} />}
            title="Failed to load token"
            description={errorMessage ?? "Something went wrong."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            <Card className="flex items-center gap-4">
              <TokenIcon logoURI={logoURI} symbol={symbol} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-bold tracking-tight text-gray-950 md:text-2xl">
                    {symbol}
                  </h1>
                  {verified && (
                    <Badge variant="success" className="px-2 py-0.5 text-xs">
                      Verified
                    </Badge>
                  )}
                  {risk && (
                    <Badge variant="warning" className="px-2 py-0.5 text-xs">
                      Risk
                    </Badge>
                  )}
                </div>
                <div className="truncate text-sm text-gray-500">{name}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Link
                  href={`/alerts?chainId=${chainId}&tokenAddress=${address}&symbol=${encodeURIComponent(symbol)}`}
                >
                  <Button variant="secondary" size="small" className="w-full">
                    <Bell className="h-3.5 w-3.5" aria-hidden />
                    Set Alert
                  </Button>
                </Link>
                <Button
                  variant={isFavorite ? "primary" : "secondary"}
                  size="small"
                  onClick={() => void toggleFavorite()}
                  disabled={!isConnected}
                  loading={prefs.addFavoritePending || prefs.removeFavoritePending}
                  title={
                    isConnected
                      ? undefined
                      : "Connect a wallet to add favorites"
                  }
                  className="w-full"
                >
                  <Star className="h-3.5 w-3.5" aria-hidden />
                  {isFavorite ? "Favorited" : "Favorite"}
                </Button>
              </div>
            </Card>

            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Price
                  </div>
                  <div className="mt-1 text-3xl font-bold tracking-tight text-gray-950 tabular-nums">
                    {formatUsd(price?.priceUsd)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    {quoteSymbol && (
                      <span>via {quoteSymbol}</span>
                    )}
                    {price?.blockNumber != null && (
                      <>
                        <span aria-hidden>·</span>
                        <span>block {price.blockNumber}</span>
                      </>
                    )}
                  </div>
                </div>
                {price && <AuthenticityBadge authenticity={price.authenticity} />}
              </div>
              {price?.source && (
                <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400">
                  Source: <span className="font-mono">{price.source}</span>
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-gray-900">Contract</span>
                <CopyAddressButton address={address} />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="break-all font-mono text-sm text-gray-600">
                  {address}
                </span>
                <a
                  href={`${explorerUrl}/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-gray-400 transition-colors hover:text-accent-500"
                  aria-label="View on block explorer"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              </div>
            </Card>

            <TokenSecurityCard address={address} chainId={chainId} />

            <Card>
              <div className="divide-y divide-gray-100">
                <DetailRow label="Decimals">{decimals ?? "—"}</DetailRow>
                <DetailRow label="Chain">
                  {chain ? `${chain.name} (${chain.id})` : chainId}
                </DetailRow>
                <DetailRow label="Metadata source">
                  {token?.source ?? (local ? "local catalog" : "—")}
                </DetailRow>
              </div>
            </Card>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
