"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";

/**
 * 顶栏通知铃铛 + 未读角标。
 * 未连接钱包或未读数为 0 时不显示角标；铃铛始终展示并跳转 /notifications。
 */
export function NotificationBell() {
  const { address, isConnected } = useAccount();
  const { unreadCount } = useNotifications(isConnected ? address : undefined);

  const showBadge = isConnected && (unreadCount ?? 0) > 0;
  const count = showBadge ? (unreadCount ?? 0) : 0;

  return (
    <Link
      href="/notifications"
      aria-label="Notifications"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-950"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {showBadge && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
