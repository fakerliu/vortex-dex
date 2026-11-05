"use client";

import { useAccount } from "wagmi";
import { AlertTriangle, Bell, CheckCheck, Wallet } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import type { Notification } from "@/types/notifications";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { PageContainer } from "@/components/layout/PageContainer";
import { cn } from "@/utils/cn";

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function NotificationRow({
  notification,
  busy,
  onMarkRead,
}: {
  notification: Notification;
  busy: boolean;
  onMarkRead: (notification: Notification) => void;
}) {
  const unread = !notification.read;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (unread) onMarkRead(notification);
        }}
        disabled={busy}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
          unread
            ? "border-accent-500/30 bg-accent-500/[0.04] hover:bg-accent-500/[0.08]"
            : "border-gray-200 bg-white opacity-75 hover:bg-gray-50",
          busy && "cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            unread ? "bg-accent-500" : "bg-gray-300",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm",
              unread ? "font-semibold text-gray-950" : "font-medium text-gray-600",
            )}
          >
            {notification.title}
          </span>
          <span className="mt-0.5 block text-sm text-gray-500">
            {notification.body}
          </span>
          <span className="mt-1.5 block text-xs text-gray-400">
            {formatTime(notification.createdAt)}
          </span>
        </span>
      </button>
    </li>
  );
}

function NotificationsSkeleton() {
  return (
    <Card className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      ))}
    </Card>
  );
}

export function NotificationsView() {
  const { address, isConnected } = useAccount();
  const notifications = useNotifications(address);

  const unreadTotal = (notifications.data ?? []).filter((n) => !n.read).length;

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Notifications
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Stay on top of your price alerts and account activity.
          </p>
        </div>

        {!isConnected || !address ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Connect your wallet"
            description="Connect a wallet to view your notifications."
            action={<WalletConnectButton />}
          />
        ) : !notifications.apiConfigured ? (
          <EmptyState
            icon={<Bell className="h-8 w-8" />}
            title="Notifications service not connected"
            description="The notifications backend is not configured yet."
          />
        ) : (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Inbox
                {unreadTotal > 0 && (
                  <span className="ml-2 rounded-full bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-500">
                    {unreadTotal} unread
                  </span>
                )}
              </h2>
              <Button
                variant="secondary"
                size="small"
                onClick={() => void notifications.markAllRead()}
                loading={notifications.markAllReadPending}
                disabled={notifications.markAllReadPending || unreadTotal === 0}
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                Mark all read
              </Button>
            </div>

            {notifications.isLoading && !notifications.data ? (
              <div className="mt-4">
                <NotificationsSkeleton />
              </div>
            ) : notifications.isError ? (
              <div className="mt-4">
                <EmptyState
                  icon={<AlertTriangle className="h-6 w-6" />}
                  title="Failed to load notifications"
                  description={
                    notifications.errorMessage ?? "Something went wrong."
                  }
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => notifications.refetch()}
                    >
                      Retry
                    </Button>
                  }
                />
              </div>
            ) : (notifications.data ?? []).length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={<Bell className="h-6 w-6" />}
                  title="No notifications yet"
                  description="Price alert triggers and account updates will appear here."
                />
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {(notifications.data ?? []).map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    busy={notifications.markReadPending}
                    onMarkRead={(notification) =>
                      void notifications.markRead(notification.id)
                    }
                  />
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
