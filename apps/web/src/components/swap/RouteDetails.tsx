"use client";

import { ChevronDown } from "lucide-react";
import type { Quote } from "@/types/quote";
import { truncateAddress } from "@/utils/format";
import { cn } from "@/utils/cn";

/** 协议类型标识的展示文案。 */
function kindLabel(kind: string): string {
  switch (kind.toLowerCase()) {
    case "cl":
      return "CL";
    case "classic":
      return "Classic";
    case "stable":
      return "Stable";
    case "v2":
      return "V2";
    case "v3":
      return "V3";
    default:
      return kind.toUpperCase();
  }
}

export function RouteDetails({
  quote,
  open,
  onToggle,
}: {
  quote?: Quote;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-2 border-t border-gray-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between py-3 text-sm font-medium text-gray-700"
      >
        <span>Route Details</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-500 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="pb-3">
          {quote && quote.route.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-500">
                Best route via{" "}
                <span className="font-semibold text-gray-700">
                  {quote.protocolName || quote.protocol || "Unknown"}
                </span>
              </p>
              {quote.route.map((step, i) => (
                <div
                  key={`${step.pool}-${i}`}
                  className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-300 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                      {kindLabel(step.kind)}
                    </span>
                    <span className="font-mono text-gray-700">
                      {truncateAddress(step.pool)}
                    </span>
                  </div>
                  <span className="text-gray-500">hop {i + 1}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              The best route will appear here once a quote is available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
