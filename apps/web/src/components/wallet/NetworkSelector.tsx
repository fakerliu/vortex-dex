"use client";

import { useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { SUPPORTED_CHAINS, type SupportedChainId } from "@/config/chains";
import { cn } from "@/utils/cn";

export function NetworkSelector() {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [open, setOpen] = useState(false);

  const current =
    SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? SUPPORTED_CHAINS[0];

  const handleSwitch = (targetId: SupportedChainId) => {
    setOpen(false);
    if (targetId !== chainId) {
      switchChain({ chainId: targetId });
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-300 px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isConnected ? "bg-success" : "bg-gray-400",
          )}
          aria-hidden
        />
        <span className="hidden sm:inline">{current.name}</span>
        <span className="sm:hidden">
          {current.id === 8453 ? "Base" : "Sepolia"}
        </span>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-card border border-gray-200 bg-white p-2 shadow-lg">
            <div className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              Network
            </div>
            {SUPPORTED_CHAINS.map((chain) => {
              const active = chain.id === chainId;
              return (
                <button
                  key={chain.id}
                  type="button"
                  onClick={() => handleSwitch(chain.id as SupportedChainId)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-gray-100 text-gray-950"
                      : "text-gray-700 hover:bg-gray-100",
                  )}
                >
                  {isPending && active ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                  ) : (
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        active ? "bg-success" : "bg-gray-300",
                      )}
                      aria-hidden
                    />
                  )}
                  <span className="flex-1 text-left">{chain.name}</span>
                  {active && <Check className="h-4 w-4 text-accent-500" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
