"use client";

import { useAccount } from "wagmi";
import { ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { useApprovals } from "@/hooks/useApprovals";
import { isSupportedChain, getExplorerUrl } from "@/config/chains";
import { BASE_CHAIN_ID } from "@/config/tokens";
import { formatDecimalString, truncateAddress } from "@/utils/format";
import { cn } from "@/utils/cn";
import { AuthenticityBadge } from "@/components/market/AuthenticityBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { TokenIcon } from "@/components/token/TokenIcon";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { PageContainer } from "@/components/layout/PageContainer";
import type { ApprovalItemDto } from "@/types/approval";

/** ERC20 无限授权（uint256 max）的宽松阈值：超出即视为「Unlimited」，纯字符串判断，无 Float。 */
const UNLIMITED_THRESHOLD = 10n ** 30n;

/**
 * 授权额度的展示格式化：
 * - 无授权额度 -> "0"；
 * - 超大额度（典型为 ERC20 无限授权 uint256 max）-> "Unlimited"；
 * - 其余 -> 十进制字符串限制小数位（纯字符串，无 Float）。
 */
function formatAllowance(item: ApprovalItemDto): string {
  if (!item.hasAllowance) return "0";
  try {
    if (BigInt(item.allowance) >= UNLIMITED_THRESHOLD) return "Unlimited";
  } catch {
    // allowance 非纯整数字符串时回退到后端已格式化的十进制字符串。
  }
  return formatDecimalString(item.allowanceFormatted, 6);
}

function ApprovalRow({ item }: { item: ApprovalItemDto }) {
  const risky = item.hasAllowance;
  // symbol 为 null（链上读不到元数据）时回退为截断地址。
  const symbol = item.symbol ?? truncateAddress(item.token, 6);
  return (
    <li
      className={cn(
        "px-4 py-3.5 transition-colors",
        risky && "bg-warning/5",
      )}
    >
      <div className="flex items-center gap-3">
        <TokenIcon symbol={symbol} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-900">
              {symbol}
            </span>
            {risky ? (
              <Badge variant="warning" className="px-2 py-0.5 text-xs">
                Approved
              </Badge>
            ) : (
              <Badge variant="neutral" className="px-2 py-0.5 text-xs">
                Not approved
              </Badge>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-gray-500">
            {truncateAddress(item.token)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-sm font-semibold text-gray-900 tabular-nums">
            {formatAllowance(item)}
          </div>
          <div className="mt-1">
            <AuthenticityBadge authenticity={item.authenticity} />
          </div>
        </div>
      </div>

      {risky && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Approved — this spender can move these tokens. Revoke to reduce risk.
          </span>
        </div>
      )}
    </li>
  );
}

function ApprovalSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-24 w-full" />
      <Card className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function ApprovalView() {
  const { address, isConnected, chainId } = useAccount();
  const resolvedChainId = isSupportedChain(chainId) ? chainId! : BASE_CHAIN_ID;

  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    useApprovals(address, resolvedChainId);

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Token Approvals
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Review the token allowances granted to the VORTEX DEX router.
          </p>
        </div>

        {!isConnected || !address ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Connect your wallet"
            description="Connect a wallet to review and manage your token approvals."
            action={<WalletConnectButton />}
          />
        ) : !apiConfigured ? (
          <EmptyState
            icon={<ShieldCheck className="h-8 w-8" />}
            title="Approval service not connected"
            description="The approval backend is not configured yet."
          />
        ) : isError ? (
          <EmptyState
            icon={<ShieldCheck className="h-8 w-8" />}
            title="Failed to load approvals"
            description={errorMessage ?? "Something went wrong."}
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : isLoading && !data ? (
          <ApprovalSkeleton />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-8 w-8" />}
            title="No token approvals"
            description="This wallet has no token allowances on this chain yet."
          />
        ) : (
          <>
            <Card>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Approved spender
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="font-mono text-sm font-medium text-gray-900">
                  {truncateAddress(data.spender, 6)}
                </span>
                <a
                  href={`${getExplorerUrl(resolvedChainId)}/address/${data.spender}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent-500 hover:text-accent-400"
                >
                  View on explorer
                </a>
              </div>
              <div className="mt-1.5 text-xs text-gray-500">
                {data.items.length} token allowance
                {data.items.length === 1 ? "" : "s"} ·{" "}
                {truncateAddress(data.wallet)}
              </div>
            </Card>

            <Card className="p-0">
              <ul className="divide-y divide-gray-100">
                {data.items.map((item) => (
                  <ApprovalRow
                    key={`${item.chainId}-${item.token}-${item.spender}`}
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
