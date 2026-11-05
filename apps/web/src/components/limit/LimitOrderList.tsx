"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import {
  AlertTriangle,
  ArrowDown,
  Clock,
  ExternalLink,
  History,
  ListOrdered,
  Loader2,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { LimitOrderStatusBadge } from "./LimitOrderStatusBadge";
import { useLimitOrders } from "@/hooks/useLimitOrders";
import { getTokenByAddress } from "@/config/tokens";
import {
  formatDecimalString,
  formatTokenAmount,
  truncateAddress,
} from "@/utils/format";
import type { LimitOrderDto } from "@/types/limit-order";

function tokenSymbol(address: string, chainId: number): string {
  return getTokenByAddress(address, chainId)?.symbol ?? truncateAddress(address);
}

function tokenDecimals(address: string, chainId: number): number {
  return getTokenByAddress(address, chainId)?.decimals ?? 18;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function LimitOrderRow({
  order,
  onCancel,
  cancelPending,
}: {
  order: LimitOrderDto;
  onCancel: (order: LimitOrderDto) => void;
  cancelPending: boolean;
}) {
  const canCancel = order.status === "pending";
  const decimalsIn = tokenDecimals(order.tokenIn, order.chainId);
  const decimalsOut = tokenDecimals(order.tokenOut, order.chainId);

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-950">
              {tokenSymbol(order.tokenIn, order.chainId)}
              <ArrowDown className="mx-1 inline h-3.5 w-3.5 text-gray-400" aria-hidden />
              {tokenSymbol(order.tokenOut, order.chainId)}
            </span>
            <LimitOrderStatusBadge status={order.status} armed={order.armed} />
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {order.direction === "buy" ? "Limit buy" : "Limit sell"} · chain{" "}
            {order.chainId}
          </div>
        </div>

        {canCancel && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => onCancel(order)}
            disabled={cancelPending}
            className="text-danger hover:bg-danger/10 hover:text-danger"
          >
            {cancelPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <XCircle className="h-3.5 w-3.5" aria-hidden />
            )}
            Cancel
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-gray-500">Amount in</div>
          <div className="tabular-nums text-gray-800">
            {formatTokenAmount(order.amountIn, decimalsIn)}{" "}
            <span className="text-xs text-gray-500">
              {tokenSymbol(order.tokenIn, order.chainId)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Limit price</div>
          <div className="tabular-nums text-gray-800">
            {formatDecimalString(order.limitPrice, 8)}{" "}
            <span className="text-xs text-gray-500">
              {tokenSymbol(order.tokenIn, order.chainId)}/
              {tokenSymbol(order.tokenOut, order.chainId)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Min amount out</div>
          <div className="tabular-nums text-gray-800">
            {formatTokenAmount(order.minAmountOut, decimalsOut)}{" "}
            <span className="text-xs text-gray-500">
              {tokenSymbol(order.tokenOut, order.chainId)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Placed</div>
          <div className="text-gray-800">{formatDate(order.createdAt)}</div>
        </div>
      </div>

      {order.expiresAt && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Expires {formatDate(order.expiresAt)}
        </div>
      )}

      {order.txHash && (
        <a
          href={order.explorerUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-accent-500 hover:text-accent-400"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {truncateAddress(order.txHash, 8)}
        </a>
      )}

      {order.failureReason && (
        <div className="rounded-lg bg-danger/10 p-2.5 text-xs text-danger">
          {order.failureReason}
        </div>
      )}
    </li>
  );
}

function LimitOrderListSkeleton() {
  return (
    <Card className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-3 w-56" />
        </div>
      ))}
    </Card>
  );
}

export function LimitOrderList() {
  const { address } = useAccount();
  const orders = useLimitOrders(address);

  const { active, history } = useMemo(() => {
    const items = orders.data?.items ?? [];
    return {
      active: items.filter(
        (o) => o.status === "pending" || o.status === "triggered",
      ),
      history: items.filter(
        (o) =>
          o.status === "filled" ||
          o.status === "cancelled" ||
          o.status === "expired" ||
          o.status === "failed",
      ),
    };
  }, [orders.data]);

  if (!orders.apiConfigured) {
    return (
      <EmptyState
        icon={<ListOrdered className="h-8 w-8" />}
        title="Limit order service not connected"
        description="The limit order backend is not configured yet."
      />
    );
  }

  if (orders.isLoading && !orders.data) {
    return <LimitOrderListSkeleton />;
  }

  if (orders.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Failed to load limit orders"
        description={orders.errorMessage ?? "Something went wrong."}
        action={
          <Button variant="secondary" onClick={() => orders.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (active.length === 0 && history.length === 0) {
    return (
      <EmptyState
        icon={<ListOrdered className="h-8 w-8" />}
        title="No limit orders yet"
        description="Place a limit order above to buy tokens at your target price."
      />
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-6">
        {active.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Active ({active.length})
              </h3>
            </div>
            <ul className="flex flex-col gap-2">
              {active.map((order) => (
                <LimitOrderRow
                  key={order.id}
                  order={order}
                  onCancel={(o) => void orders.cancel(o.id)}
                  cancelPending={orders.cancelPending}
                />
              ))}
            </ul>
          </section>
        )}

        {history.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <History className="h-4 w-4 text-gray-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                History ({history.length})
              </h3>
            </div>
            <ul className="flex flex-col gap-2">
              {history.map((order) => (
                <LimitOrderRow
                  key={order.id}
                  order={order}
                  onCancel={() => {}}
                  cancelPending={false}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}
