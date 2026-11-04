"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  Wallet,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { truncateAddress } from "@/utils/format";
import { getExplorerUrl } from "@/config/chains";

export function WalletConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可用时忽略 */
    }
  };

  const handleConnect = (connector: (typeof connectors)[number]) => {
    connect({ connector });
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors",
          isConnected
            ? "border-gray-300 text-gray-800 hover:bg-gray-100"
            : "border-transparent bg-accent-500 text-white hover:bg-accent-400",
        )}
      >
        <Wallet className="h-4 w-4" aria-hidden />
        <span className="tabular-nums">
          {isPending
            ? "Connecting..."
            : isConnected && address
              ? truncateAddress(address)
              : "Connect Wallet"}
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
          <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-card border border-gray-200 bg-white shadow-lg">
            {isConnected && address ? (
              <div className="p-3">
                <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                  <span className="truncate font-mono text-sm text-gray-800 tabular-nums">
                    {address}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={`${getExplorerUrl(chainId)}/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Explorer
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    disconnect();
                    setOpen(false);
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="p-2">
                <div className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Connect a wallet
                </div>
                {connectors.map((connector) => (
                  <button
                    key={connector.id}
                    type="button"
                    onClick={() => handleConnect(connector)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                    ) : (
                      <Wallet className="h-4 w-4 text-gray-500" />
                    )}
                    {connector.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
