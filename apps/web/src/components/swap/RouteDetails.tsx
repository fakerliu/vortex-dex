"use client";

import { ChevronDown } from "lucide-react";
import type { Quote } from "@/types/quote";
import { cn } from "@/utils/cn";

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
              {quote.route.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-300 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                      {step.poolType}
                    </span>
                    <span className="text-gray-700">{step.pool}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <span>{(step.feeBps / 100).toFixed(2)}%</span>
                    <span>{step.portion}%</span>
                  </div>
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
