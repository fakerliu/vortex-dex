"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";
import { useAlerts } from "@/hooks/useAlerts";
import { isSupportedChain } from "@/config/chains";
import { BASE_CHAIN_ID } from "@/config/tokens";
import { formatUsd, truncateAddress } from "@/utils/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { PageContainer } from "@/components/layout/PageContainer";
import type { AlertCondition, PriceAlert } from "@/types/alerts";
import { cn } from "@/utils/cn";

const STATUS_ORDER: PriceAlert["status"][] = ["triggered", "active", "paused"];

const STATUS_LABEL: Record<PriceAlert["status"], string> = {
  triggered: "Triggered",
  active: "Active",
  paused: "Paused",
};

const CONDITION_LABEL: Record<AlertCondition, string> = {
  gte: "rises above",
  lte: "falls below",
};

const CONDITION_SYMBOL: Record<AlertCondition, string> = {
  gte: "≥",
  lte: "≤",
};

function AlertStatusBadge({ status }: { status: PriceAlert["status"] }) {
  const variant =
    status === "triggered" ? "error" : status === "paused" ? "neutral" : "info";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

function AlertRow({
  alert,
  onEdit,
  onToggleStatus,
  onDelete,
  busy,
}: {
  alert: PriceAlert;
  onEdit: (alert: PriceAlert) => void;
  onToggleStatus: (alert: PriceAlert) => void;
  onDelete: (alert: PriceAlert) => void;
  busy: boolean;
}) {
  const isTriggered = alert.status === "triggered";
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4",
        isTriggered ? "border-danger/40 bg-danger/5" : "border-gray-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-950">
              {alert.symbol}
            </span>
            <span className="text-sm text-gray-600 tabular-nums">
              {CONDITION_SYMBOL[alert.condition]} {formatUsd(alert.targetPrice)}
            </span>
            <AlertStatusBadge status={alert.status} />
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {CONDITION_LABEL[alert.condition]} target ·{" "}
            {truncateAddress(alert.tokenAddress)} · chain {alert.chainId}
          </div>
          {isTriggered && alert.triggeredAt && (
            <div className="mt-1 text-xs font-medium text-danger">
              Triggered at {new Date(alert.triggeredAt).toLocaleString()}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleStatus(alert)}
            disabled={busy}
            title={alert.status === "paused" ? "Resume" : "Pause"}
            aria-label={alert.status === "paused" ? "Resume" : "Pause"}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
          >
            {alert.status === "paused" ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onEdit(alert)}
            disabled={busy}
            title="Edit"
            aria-label="Edit"
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(alert)}
            disabled={busy}
            title="Delete"
            aria-label="Delete"
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

function AlertsSkeleton() {
  return (
    <Card className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </Card>
  );
}

export function AlertsView({
  initialChainId,
  initialTokenAddress,
  initialSymbol,
}: {
  initialChainId?: string;
  initialTokenAddress?: string;
  initialSymbol?: string;
}) {
  const { address, isConnected, chainId } = useAccount();
  const alerts = useAlerts(address);

  // 创建提醒的链：优先用 Token Detail 页跳转预填的 chainId，否则取钱包当前链，回退主网。
  const resolvedChainId = useMemo(() => {
    const prefilled = initialChainId ? Number(initialChainId) : NaN;
    if (prefilled === 8453 || prefilled === 84532) return prefilled;
    return isSupportedChain(chainId) ? chainId! : BASE_CHAIN_ID;
  }, [initialChainId, chainId]);

  const [tokenAddress, setTokenAddress] = useState(initialTokenAddress ?? "");
  const [symbol, setSymbol] = useState(initialSymbol ?? "");
  const [condition, setCondition] = useState<AlertCondition>("gte");
  const [targetPrice, setTargetPrice] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [editing, setEditing] = useState<PriceAlert | null>(null);
  const [editCondition, setEditCondition] = useState<AlertCondition>("gte");
  const [editTargetPrice, setEditTargetPrice] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<PriceAlert["status"], PriceAlert[]>();
    for (const status of STATUS_ORDER) map.set(status, []);
    for (const alert of alerts.data ?? []) {
      map.get(alert.status)?.push(alert);
    }
    return map;
  }, [alerts.data]);

  const handleCreate = async () => {
    const trimmedAddress = tokenAddress.trim();
    const trimmedSymbol = symbol.trim();
    const trimmedPrice = targetPrice.trim();

    if (!trimmedAddress || !trimmedSymbol || !trimmedPrice) {
      setFormError("Token address, symbol, and target price are required.");
      return;
    }
    if (!/^\d*\.?\d*$/.test(trimmedPrice) || trimmedPrice === "") {
      setFormError("Target price must be a valid number.");
      return;
    }

    setFormError(null);
    try {
      await alerts.create({
        userAddress: address!,
        chainId: resolvedChainId,
        tokenAddress: trimmedAddress,
        symbol: trimmedSymbol,
        condition,
        targetPrice: trimmedPrice,
      });
      setTokenAddress("");
      setSymbol("");
      setTargetPrice("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create alert.");
    }
  };

  const openEdit = (alert: PriceAlert) => {
    setEditing(alert);
    setEditCondition(alert.condition);
    setEditTargetPrice(alert.targetPrice);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const trimmedPrice = editTargetPrice.trim();
    if (!trimmedPrice || !/^\d*\.?\d*$/.test(trimmedPrice)) {
      setEditError("Target price must be a valid number.");
      return;
    }
    setEditError(null);
    try {
      await alerts.update(editing.id, {
        condition: editCondition,
        targetPrice: trimmedPrice,
      });
      setEditing(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update alert.");
    }
  };

  const handleToggleStatus = async (alert: PriceAlert) => {
    const nextStatus = alert.status === "paused" ? "active" : "paused";
    try {
      await alerts.update(alert.id, { status: nextStatus });
    } catch {
      /* 失败静默：列表未变化即可 */
    }
  };

  const handleDelete = async (alert: PriceAlert) => {
    try {
      await alerts.remove(alert.id);
    } catch {
      /* 失败静默 */
    }
  };

  const checkResult = alerts.checkResult;

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Price Alerts
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Get notified when a token price hits your target.
          </p>
        </div>

        {!isConnected || !address ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Connect your wallet"
            description="Connect a wallet to create and manage price alerts."
            action={<WalletConnectButton />}
          />
        ) : !alerts.apiConfigured ? (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title="Alerts service not connected"
            description="The price alerts backend is not configured yet."
          />
        ) : (
          <>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  New Alert
                </h2>
                <span className="text-xs text-gray-500">
                  chain {resolvedChainId}
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    value={tokenAddress}
                    onChange={(e) => setTokenAddress(e.target.value)}
                    placeholder="Token address (0x…)"
                  />
                  <Input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="Symbol (e.g. WETH)"
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex flex-1 items-center gap-1 rounded-xl border border-gray-300 p-1">
                    {(["gte", "lte"] as AlertCondition[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCondition(c)}
                        className={cn(
                          "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          condition === c
                            ? "bg-accent-500 text-white"
                            : "text-gray-600 hover:bg-gray-100",
                        )}
                      >
                        {c === "gte" ? "Rises above (≥)" : "Falls below (≤)"}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder="Target price (USD)"
                    startAdornment={<span className="text-sm">$</span>}
                    className="sm:w-48"
                  />
                </div>

                {formError && (
                  <div className="text-sm text-danger">{formError}</div>
                )}

                <Button
                  onClick={handleCreate}
                  loading={alerts.createPending}
                  disabled={alerts.createPending}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Create Alert
                </Button>
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  Your Alerts
                </h2>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => void alerts.runCheck()}
                  loading={alerts.checkPending}
                  disabled={alerts.checkPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Check Now
                </Button>
              </div>

              {checkResult && (
                <div className="mt-3 rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
                  <span className="font-medium">
                    {checkResult.checked} active alert
                    {checkResult.checked === 1 ? "" : "s"} checked
                  </span>
                  {checkResult.triggered.length > 0 ? (
                    <span className="text-danger">
                      {" "}
                      · {checkResult.triggered.length} triggered
                    </span>
                  ) : (
                    <span className="text-success"> · none triggered</span>
                  )}
                </div>
              )}

              {alerts.isLoading && !alerts.data ? (
                <div className="mt-4">
                  <AlertsSkeleton />
                </div>
              ) : alerts.isError ? (
                <div className="mt-4">
                  <EmptyState
                    icon={<AlertTriangle className="h-6 w-6" />}
                    title="Failed to load alerts"
                    description={alerts.errorMessage ?? "Something went wrong."}
                    action={
                      <Button variant="secondary" onClick={() => alerts.refetch()}>
                        Retry
                      </Button>
                    }
                  />
                </div>
              ) : (alerts.data ?? []).length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    icon={<Bell className="h-6 w-6" />}
                    title="No alerts yet"
                    description="Create an alert above to get notified on price moves."
                  />
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-6">
                  {STATUS_ORDER.map((status) => {
                    const items = grouped.get(status) ?? [];
                    if (items.length === 0) return null;
                    return (
                      <section key={status}>
                        <div className="mb-2 flex items-center gap-2">
                          {status === "triggered" ? (
                            <BellRing className="h-4 w-4 text-danger" />
                          ) : status === "active" ? (
                            <Bell className="h-4 w-4 text-accent-500" />
                          ) : (
                            <Pause className="h-4 w-4 text-gray-400" />
                          )}
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {STATUS_LABEL[status]} ({items.length})
                          </h3>
                        </div>
                        <ul className="flex flex-col gap-2">
                          {items.map((alert) => (
                            <AlertRow
                              key={alert.id}
                              alert={alert}
                              onEdit={openEdit}
                              onToggleStatus={(a) => void handleToggleStatus(a)}
                              onDelete={(a) => void handleDelete(a)}
                              busy={
                                alerts.updatePending || alerts.removePending
                              }
                            />
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Alert"
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-950">
                {editing.symbol}
              </span>
              <span className="text-xs text-gray-500">
                {truncateAddress(editing.tokenAddress)}
              </span>
            </div>

            <div className="flex items-center gap-1 rounded-xl border border-gray-300 p-1">
              {(["gte", "lte"] as AlertCondition[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditCondition(c)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    editCondition === c
                      ? "bg-accent-500 text-white"
                      : "text-gray-600 hover:bg-gray-100",
                  )}
                >
                  {c === "gte" ? "≥" : "≤"}
                </button>
              ))}
            </div>

            <Input
              value={editTargetPrice}
              onChange={(e) => setEditTargetPrice(e.target.value)}
              placeholder="Target price (USD)"
              startAdornment={<span className="text-sm">$</span>}
            />

            {editError && <div className="text-sm text-danger">{editError}</div>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                loading={alerts.updatePending}
                disabled={alerts.updatePending}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
