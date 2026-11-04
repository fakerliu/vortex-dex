"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { useAccount } from "wagmi";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { TokenIcon } from "./TokenIcon";
import { getTokensByChain } from "@/config/tokens";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import type { Token } from "@/types/token";
import { cn } from "@/utils/cn";

const POPULAR_SYMBOLS = ["WETH", "USDC", "DAI", "USDT"];

function TokenRow({
  token,
  selected,
  showBalance,
  onSelect,
}: {
  token: Token;
  selected: boolean;
  showBalance: boolean;
  onSelect: (token: Token) => void;
}) {
  const balance = useTokenBalance(showBalance ? token : null);

  return (
    <button
      type="button"
      onClick={() => onSelect(token)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-gray-100" : "hover:bg-gray-100",
      )}
    >
      <TokenIcon
        logoURI={token.logoURI}
        symbol={token.symbol}
        size={36}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-gray-950">
            {token.symbol}
          </span>
          {token.verified && (
            <Tooltip content="Verified token">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-label="Verified" />
            </Tooltip>
          )}
          {token.risk && <Badge variant="warning">Risk</Badge>}
        </div>
        <div className="truncate text-xs text-gray-500">{token.name}</div>
      </div>
      <div className="text-right">
        {balance.isLoading ? (
          <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
        ) : (
          <div className="text-sm text-gray-700 tabular-nums">
            {balance.formatted}
          </div>
        )}
      </div>
    </button>
  );
}

export function TokenSelector({
  open,
  onClose,
  onSelect,
  selectedAddress,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (token: Token) => void;
  selectedAddress?: string;
}) {
  const { chainId } = useAccount();
  const [query, setQuery] = useState("");

  // 按当前钱包网络取可选代币（未连接/未知网络回退主网列表）。
  const chainTokens = useMemo(
    () => getTokensByChain(chainId ?? 8453),
    [chainId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chainTokens;
    return chainTokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q),
    );
  }, [query, chainTokens]);

  const popular = useMemo(
    () =>
      POPULAR_SYMBOLS.map((s) => chainTokens.find((t) => t.symbol === s)).filter(
        (t): t is Token => Boolean(t),
      ),
    [chainTokens],
  );

  const handleSelect = (token: Token) => {
    onSelect(token);
    setQuery("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Select Token">
      <div className="flex flex-col gap-4">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, symbol, or address"
          startAdornment={<Search className="h-4 w-4" />}
        />

        <div className="max-h-[50vh] overflow-y-auto">
          {query.trim() === "" && (
            <div className="mb-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Popular Tokens
              </div>
              <div className="grid grid-cols-4 gap-2">
                {popular.map((token) => (
                  <button
                    key={token.address}
                    type="button"
                    onClick={() => handleSelect(token)}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 p-2.5 transition-colors hover:border-gray-300 hover:bg-gray-100"
                  >
                    <TokenIcon
                      logoURI={token.logoURI}
                      symbol={token.symbol}
                      size={32}
                    />
                    <span className="text-xs font-medium text-gray-800">
                      {token.symbol}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            {query.trim() === "" ? "All Tokens" : "Results"}
          </div>

          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              No tokens found
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((token) => (
                <TokenRow
                  key={`${token.chainId}-${token.address}`}
                  token={token}
                  selected={token.address === selectedAddress}
                  showBalance={open}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
