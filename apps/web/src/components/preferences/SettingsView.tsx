"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  AlertTriangle,
  CheckCircle2,
  Settings,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import { usePreferences } from "@/hooks/usePreferences";
import { truncateAddress } from "@/utils/format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { PageContainer } from "@/components/layout/PageContainer";
import type { FavoriteToken } from "@/types/preferences";
import { cn } from "@/utils/cn";

const CHAIN_OPTIONS = [
  { id: 8453, label: "Base (8453)" },
  { id: 84532, label: "Base Sepolia (84532)" },
];

const DEFAULT_FORM = {
  slippageBps: 50,
  chainId: 8453,
  deadlineSec: 1200,
  notifyAlerts: true,
};

function FavoriteRow({
  fav,
  onRemove,
  busy,
}: {
  fav: FavoriteToken;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600">
          <Star className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">{fav.symbol}</div>
          <div className="truncate text-xs text-gray-500">
            {truncateAddress(fav.address)} · chain {fav.chainId}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        title="Remove favorite"
        aria-label={`Remove ${fav.symbol} from favorites`}
        className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

export function SettingsView() {
  const { address, isConnected } = useAccount();
  const prefs = usePreferences(address);

  const [form, setForm] = useState(DEFAULT_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 偏好加载成功后回填表单（保存成功会写回 data，随之再次同步）。
  useEffect(() => {
    if (!prefs.data) return;
    setForm({
      slippageBps: prefs.data.defaultSlippageBps,
      chainId: prefs.data.defaultChainId,
      deadlineSec: prefs.data.defaultDeadlineSec,
      notifyAlerts: prefs.data.notifyAlerts,
    });
  }, [prefs.data]);

  const handleSave = async () => {
    setSaveError(null);
    setSaved(false);

    if (
      !Number.isInteger(form.slippageBps) ||
      form.slippageBps < 0 ||
      form.slippageBps > 10000
    ) {
      setSaveError("Slippage must be an integer between 0 and 10000 (bps).");
      return;
    }
    if (!Number.isInteger(form.deadlineSec) || form.deadlineSec <= 0) {
      setSaveError("Deadline must be a positive integer (seconds).");
      return;
    }

    try {
      await prefs.update({
        defaultSlippageBps: form.slippageBps,
        defaultChainId: form.chainId,
        defaultDeadlineSec: form.deadlineSec,
        notifyAlerts: form.notifyAlerts,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save preferences.",
      );
    }
  };

  const favorites = prefs.data?.favoriteTokens ?? [];

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Settings
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Manage your trading preferences and favorite tokens.
          </p>
        </div>

        {!isConnected || !address ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Connect your wallet"
            description="Connect a wallet to manage your preferences."
            action={<WalletConnectButton />}
          />
        ) : !prefs.apiConfigured ? (
          <EmptyState
            icon={<Settings className="h-8 w-8" />}
            title="Preferences service not connected"
            description="The preferences backend is not configured yet."
          />
        ) : (
          <>
            <Card>
              <h2 className="text-sm font-semibold text-gray-900">
                Trading Preferences
              </h2>

              {prefs.isLoading && !prefs.data ? (
                <div className="mt-4 space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-gray-500">
                      Default slippage (bps)
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      value={form.slippageBps}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          slippageBps: Number(e.target.value),
                        }))
                      }
                    />
                    <span className="text-xs text-gray-400">
                      {(form.slippageBps / 100).toFixed(2)}% · 50 bps = 0.5%
                    </span>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-gray-500">
                      Default chain
                    </span>
                    <select
                      value={form.chainId}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          chainId: Number(e.target.value),
                        }))
                      }
                      className="h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-base text-gray-950 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    >
                      {CHAIN_OPTIONS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-gray-500">
                      Default deadline (seconds)
                    </span>
                    <Input
                      type="number"
                      min={1}
                      value={form.deadlineSec}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          deadlineSec: Number(e.target.value),
                        }))
                      }
                    />
                  </label>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-800">
                        Price alert notifications
                      </div>
                      <div className="text-xs text-gray-500">
                        Show triggered alerts in-app.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.notifyAlerts}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          notifyAlerts: !f.notifyAlerts,
                        }))
                      }
                      className={cn(
                        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                        form.notifyAlerts ? "bg-accent-500" : "bg-gray-300",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                          form.notifyAlerts
                            ? "translate-x-5"
                            : "translate-x-0.5",
                        )}
                      />
                    </button>
                  </div>

                  {saveError && (
                    <div className="text-sm text-danger">{saveError}</div>
                  )}
                  {saved && (
                    <div className="flex items-center gap-1.5 text-sm text-success">
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      Preferences saved.
                    </div>
                  )}

                  <Button
                    onClick={handleSave}
                    loading={prefs.updatePending}
                    disabled={prefs.updatePending}
                  >
                    Save Preferences
                  </Button>
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  Favorite Tokens
                </h2>
                <span className="text-xs text-gray-500">
                  {favorites.length} token{favorites.length === 1 ? "" : "s"}
                </span>
              </div>

              {prefs.isLoading && !prefs.data ? (
                <div className="mt-4 space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : prefs.isError && !prefs.data ? (
                <div className="mt-4">
                  <EmptyState
                    icon={<AlertTriangle className="h-6 w-6" />}
                    title="Failed to load favorites"
                    description={prefs.errorMessage ?? "Something went wrong."}
                    action={
                      <Button variant="secondary" onClick={() => prefs.refetch()}>
                        Retry
                      </Button>
                    }
                  />
                </div>
              ) : favorites.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    icon={<Star className="h-6 w-6" />}
                    title="No favorites yet"
                    description="Add favorites from any token detail page."
                  />
                </div>
              ) : (
                <ul className="mt-2 divide-y divide-gray-100">
                  {favorites.map((fav) => (
                    <FavoriteRow
                      key={`${fav.chainId}-${fav.address}`}
                      fav={fav}
                      onRemove={() =>
                        void prefs
                          .removeFavorite(fav.chainId, fav.address)
                          .catch(() => {})
                      }
                      busy={prefs.removeFavoritePending}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </PageContainer>
  );
}
