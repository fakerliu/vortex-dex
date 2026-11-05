"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck, Star } from "lucide-react";
import { useAccount } from "wagmi";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { TokenIcon } from "./TokenIcon";
import { getTokensByChain } from "@/config/tokens";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { usePreferences } from "@/hooks/usePreferences";
import type { Token } from "@/types/token";
import { cn } from "@/utils/cn";

const POPULAR_SYMBOLS = ["WETH", "USDC", "DAI", "USDT"];

function TokenRow({
  token,
  selected,
  showBalance,
  onSelect,
  favoriteEnabled,
  favorite,
  favoritePending,
  onToggleFavorite,
}: {
  token: Token;
  selected: boolean;
  showBalance: boolean;
  onSelect: (token: Token) => void;
  favoriteEnabled: boolean;
  favorite: boolean;
  favoritePending: boolean;
  onToggleFavorite: (token: Token) => void;
}) {
  const balance = useTokenBalance(showBalance ? token : null);

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-xl transition-colors",
        selected ? "bg-gray-100" : "hover:bg-gray-100",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(token)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left"
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

      {favoriteEnabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(token);
          }}
          disabled={favoritePending}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={
            favorite
              ? `Remove ${token.symbol} from favorites`
              : `Add ${token.symbol} to favorites`
          }
          className={cn(
            "mr-2 shrink-0 rounded-lg p-2 transition-colors",
            favorite
              ? "text-gray-800 hover:text-gray-600"
              : "text-gray-400 hover:text-gray-700",
            favoritePending && "opacity-50",
          )}
        >
          <Star
            className={cn("h-4 w-4", favorite && "fill-current")}
            aria-hidden
          />
        </button>
      )}
    </div>
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
  const { chainId, address } = useAccount();
  const prefs = usePreferences(address);
  const [query, setQuery] = useState("");

  // 收藏能力可用性：已配置后端且钱包已连接（hook 内部已用 enabled 保护，此处仅控制 UI 展示）。
  const favoriteEnabled = prefs.apiConfigured && Boolean(address);

  // 按当前钱包网络取可选代币（未连接/未知网络回退主网列表）。
  const chainTokens = useMemo(
    () => getTokensByChain(chainId ?? 8453),
    [chainId],
  );

  // 收藏代币键集合（chainId + 小写地址），用于星标状态与收藏区匹配。
  const favoriteKeys = useMemo(() => {
    const set = new Set<string>();
    for (const f of prefs.data?.favoriteTokens ?? []) {
      set.add(`${f.chainId}:${f.address.toLowerCase()}`);
    }
    return set;
  }, [prefs.data?.favoriteTokens]);

  const isFavorite = (token: Token) =>
    favoriteKeys.has(`${token.chainId}:${token.address.toLowerCase()}`);

  // 当前链上已收藏的代币（从 chainTokens 匹配回完整 Token，地址小写比较）。
  const favoriteTokens = useMemo(
    () =>
      chainTokens.filter((t) =>
        favoriteKeys.has(`${t.chainId}:${t.address.toLowerCase()}`),
      ),
    [chainTokens, favoriteKeys],
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

  const handleToggleFavorite = (token: Token) => {
    if (!address || !prefs.apiConfigured) return;
    if (isFavorite(token)) {
      void prefs.removeFavorite(token.address.toLowerCase()).catch(() => {});
    } else {
      void prefs
        .addFavorite({
          chainId: token.chainId,
          address: token.address.toLowerCase(),
          symbol: token.symbol,
        })
        .catch(() => {});
    }
  };

  const favoritePending = prefs.addFavoritePending || prefs.removeFavoritePending;

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
            <>
              {favoriteEnabled && favoriteTokens.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Favorites
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {favoriteTokens.map((token) => (
                      <TokenRow
                        key={`${token.chainId}-${token.address}`}
                        token={token}
                        selected={token.address === selectedAddress}
                        showBalance={open}
                        onSelect={handleSelect}
                        favoriteEnabled={favoriteEnabled}
                        favorite
                        favoritePending={favoritePending}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </div>
                </div>
              )}

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
            </>
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
                  favoriteEnabled={favoriteEnabled}
                  favorite={isFavorite(token)}
                  favoritePending={favoritePending}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
