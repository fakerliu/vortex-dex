"use client";

import type { Authenticity } from "@/types/market";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";

interface AuthenticityMeta {
  label: string;
  variant: BadgeVariant;
  description: string;
}

/**
 * 真实度标记 -> 展示文案 / 徽章色（与 docs/data-authenticity.md 对齐）。
 * - REAL_ONCHAIN 绿色（链上直接读取，可信度最高）
 * - REAL_PROVIDER / INTERNAL_CALCULATED 蓝色（真实但经第三方/内部推导）
 * - MOCK / STALE 琥珀色（模拟 / 过期，需用户注意）
 * - UNAVAILABLE 灰色（上游失败，字段不可用）
 */
const AUTHENTICITY_META: Record<Authenticity, AuthenticityMeta> = {
  REAL_ONCHAIN: {
    label: "On-chain",
    variant: "success",
    description: "Read directly from on-chain contracts / RPC.",
  },
  REAL_PROVIDER: {
    label: "Provider",
    variant: "info",
    description: "From a trusted third-party data provider.",
  },
  INTERNAL_CALCULATED: {
    label: "Calculated",
    variant: "info",
    description: "Derived internally from real on-chain data.",
  },
  MOCK: {
    label: "Mock",
    variant: "warning",
    description: "Simulated data — not real market state.",
  },
  UNAVAILABLE: {
    label: "Unavailable",
    variant: "neutral",
    description: "Upstream data sources failed; value is unavailable.",
  },
  STALE: {
    label: "Stale",
    variant: "warning",
    description: "Previously real but now out of date.",
  },
};

const UNKNOWN_META: AuthenticityMeta = {
  label: "Unknown",
  variant: "neutral",
  description: "Unknown data authenticity.",
};

/** 真实度标记徽章：彩色圆点 + 人类可读标签，悬停显示完整说明。 */
export function AuthenticityBadge({
  authenticity,
  className,
}: {
  authenticity: string;
  className?: string;
}) {
  const meta = AUTHENTICITY_META[authenticity as Authenticity] ?? {
    ...UNKNOWN_META,
    label: authenticity || UNKNOWN_META.label,
  };

  return (
    <Tooltip content={meta.description}>
      <Badge variant={meta.variant} className={className}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
        {meta.label}
      </Badge>
    </Tooltip>
  );
}
