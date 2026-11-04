"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { TokenButton } from "./TokenButton";
import type { Token } from "@/types/token";
import { cn } from "@/utils/cn";

export function SwapInputPanel({
  label,
  token,
  value,
  onValueChange,
  readOnly = false,
  onSelectToken,
  bottomLeft,
  bottomRight,
  loading = false,
  placeholder = "0.0",
}: {
  label: string;
  token: Token;
  value: string;
  onValueChange?: (value: string) => void;
  readOnly?: boolean;
  onSelectToken: () => void;
  bottomLeft?: React.ReactNode;
  bottomRight?: React.ReactNode;
  loading?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="rounded-xl bg-gray-100 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">{label}</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        {loading ? (
          <Skeleton className="h-10 w-40" />
        ) : (
          <input
            value={value}
            onChange={
              onValueChange ? (e) => onValueChange(e.target.value) : undefined
            }
            readOnly={readOnly}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            className={cn(
              "h-14 min-w-0 flex-1 bg-transparent text-[28px] font-semibold leading-none text-gray-950 outline-none",
              "placeholder:text-gray-400 tabular-nums",
            )}
          />
        )}
        <TokenButton token={token} onClick={onSelectToken} />
      </div>

      <div className="mt-3 flex min-h-[16px] items-center justify-between text-xs text-gray-500">
        <div className="truncate">{bottomLeft}</div>
        <div className="flex items-center gap-2">{bottomRight}</div>
      </div>
    </div>
  );
}
