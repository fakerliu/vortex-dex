"use client";

import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import type { LimitOrderStatus } from "@/types/limit-order";

const STATUS_LABEL: Record<LimitOrderStatus, string> = {
  pending: "Pending",
  triggered: "Triggered",
  filled: "Filled",
  cancelled: "Cancelled",
  expired: "Expired",
  failed: "Failed",
};

const STATUS_VARIANT: Record<LimitOrderStatus, BadgeVariant> = {
  pending: "info",
  triggered: "warning",
  filled: "success",
  cancelled: "neutral",
  expired: "neutral",
  failed: "error",
};

/**
 * 限价单状态徽章。
 * - pending 但未武装（armed=false）：说明签名尚未提交，keeper 不会触发，展示为 Pending (unsigned)。
 */
export function LimitOrderStatusBadge({
  status,
  armed,
}: {
  status: LimitOrderStatus;
  armed?: boolean;
}) {
  const label =
    status === "pending" && armed === false
      ? "Pending (unsigned)"
      : STATUS_LABEL[status];

  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}
