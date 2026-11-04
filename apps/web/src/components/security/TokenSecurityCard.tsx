"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useTokenSecurity } from "@/hooks/useTokenSecurity";
import { AuthenticityBadge } from "@/components/market/AuthenticityBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

function SecurityRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{children}</span>
    </div>
  );
}

function SecuritySkeleton() {
  return (
    <Card>
      <Skeleton className="h-5 w-24" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </Card>
  );
}

/**
 * Token Security 安全信息区块（Sprint 5）。
 * - 展示 verified / risk / hasContractCode / isInCatalog / authenticity。
 * - 未配置 API 时不渲染（页面已有全局「待接入」空态）。
 */
export function TokenSecurityCard({
  address,
  chainId,
}: {
  address: string;
  chainId: number;
}) {
  const { data, isLoading, isError, errorMessage, apiConfigured, refetch } =
    useTokenSecurity(address, chainId);

  if (!apiConfigured) return null;

  if (isLoading && !data) {
    return <SecuritySkeleton />;
  }

  if (isError && !data) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <ShieldCheck className="h-4 w-4 text-gray-400" aria-hidden />
          Security
        </div>
        <div className="mt-3 text-sm text-gray-500">
          {errorMessage ?? "Failed to load security data."}
        </div>
        <Button
          variant="secondary"
          size="small"
          className="mt-3"
          onClick={() => refetch()}
        >
          Retry
        </Button>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-gray-400" aria-hidden />
        <span className="text-sm font-semibold text-gray-900">Security</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {data.verified ? (
          <Badge variant="success" className="px-2 py-0.5 text-xs">
            Verified
          </Badge>
        ) : (
          <Badge variant="neutral" className="px-2 py-0.5 text-xs">
            Unverified
          </Badge>
        )}
        {data.risk && (
          <Badge variant="warning" className="px-2 py-0.5 text-xs">
            Risk token
          </Badge>
        )}
        <AuthenticityBadge authenticity={data.authenticity} />
      </div>

      {data.risk && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            This token is flagged as a risk asset — please trade with caution.
          </span>
        </div>
      )}

      <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
        <SecurityRow label="Contract code">
          {data.hasContractCode === true ? (
            <span className="text-success">Deployed</span>
          ) : data.hasContractCode === false ? (
            <span className="text-warning">Not found</span>
          ) : (
            <span className="text-gray-500">Unknown</span>
          )}
        </SecurityRow>
        <SecurityRow label="Official catalog">
          {data.isInCatalog ? (
            <span className="text-success">Listed</span>
          ) : (
            <span className="text-gray-500">Not listed</span>
          )}
        </SecurityRow>
      </div>
    </Card>
  );
}
