"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ArrowUpDown, Check, Settings2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SwapInputPanel } from "./SwapInputPanel";
import { SwapButton } from "./SwapButton";
import { QuoteDetails } from "./QuoteDetails";
import { RouteDetails } from "./RouteDetails";
import { TokenSelector } from "@/components/token/TokenSelector";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useQuote } from "@/hooks/useQuote";
import {
  DEFAULT_PAY_TOKEN,
  DEFAULT_RECEIVE_TOKEN,
} from "@/config/tokens";
import { isSupportedChain } from "@/config/chains";
import {
  formatTokenAmount,
  isValidAmountInput,
  parseTokenAmount,
} from "@/utils/format";
import type { Token } from "@/types/token";
import type { SwapButtonState } from "./swapState";
import { cn } from "@/utils/cn";

const SLIPPAGE_OPTIONS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
];

export function SwapCard() {
  const { isConnected, chainId } = useAccount();

  const [payToken, setPayToken] = useState<Token>(DEFAULT_PAY_TOKEN);
  const [receiveToken, setReceiveToken] = useState<Token>(DEFAULT_RECEIVE_TOKEN);
  const [amount, setAmount] = useState("");
  const [selector, setSelector] = useState<"pay" | "receive" | null>(null);
  const [slippageBps, setSlippageBps] = useState(50);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);

  const balance = useTokenBalance(payToken);

  const parsedAmount = useMemo(() => {
    if (!amount || amount === ".") return 0n;
    try {
      return parseTokenAmount(amount, payToken.decimals);
    } catch {
      return 0n;
    }
  }, [amount, payToken.decimals]);

  const hasAmount = parsedAmount > 0n;
  const sameToken =
    payToken.address.toLowerCase() === receiveToken.address.toLowerCase();

  const quoteParams = useMemo(() => {
    if (!hasAmount || sameToken) return null;
    return {
      chainId: payToken.chainId,
      inputToken: payToken.address,
      outputToken: receiveToken.address,
      inputAmount: parsedAmount.toString(),
      slippageBps,
    };
  }, [hasAmount, sameToken, payToken, receiveToken, parsedAmount, slippageBps]);

  const quote = useQuote(quoteParams);

  const state = useMemo<SwapButtonState>(() => {
    if (!isConnected) return { kind: "connect" };
    if (!isSupportedChain(chainId))
      return { kind: "switch-network", chainId: payToken.chainId };
    if (!hasAmount) return { kind: "enter-amount" };
    if (sameToken) return { kind: "same-token" };
    if (
      !balance.isLoading &&
      !balance.isError &&
      parsedAmount > BigInt(balance.raw)
    ) {
      return { kind: "insufficient-balance" };
    }
    if (quote.isLoading) return { kind: "getting-quote" };
    if (quote.notAvailable) return { kind: "quote-unavailable" };
    if (quote.isError) return { kind: "quote-error" };
    // 报价成功（Phase 2）：在此接授权检查 → approve / review
    return { kind: "review" };
  }, [
    isConnected,
    chainId,
    hasAmount,
    sameToken,
    parsedAmount,
    balance.raw,
    balance.isLoading,
    balance.isError,
    quote.isLoading,
    quote.notAvailable,
    quote.isError,
    payToken.chainId,
  ]);

  const handleAmountChange = (value: string) => {
    if (isValidAmountInput(value)) setAmount(value);
  };

  const handleMax = () => {
    if (!balance.raw || balance.raw === "0") return;
    setAmount(formatTokenAmount(balance.raw, payToken.decimals, payToken.decimals));
  };

  const swapTokens = () => {
    if (sameToken) return;
    setPayToken(receiveToken);
    setReceiveToken(payToken);
    setAmount("");
  };

  const handleSelect = (token: Token) => {
    if (selector === "pay") setPayToken(token);
    else if (selector === "receive") setReceiveToken(token);
  };

  const receiveValue = quote.quote
    ? formatTokenAmount(quote.quote.outputAmount, receiveToken.decimals)
    : "";

  const receiveHint = !hasAmount
    ? "Enter an amount to get a quote"
    : quote.notAvailable
      ? "Awaiting quote engine"
      : undefined;

  return (
    <>
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Swap</span>

          <div className="relative">
            <button
              type="button"
              onClick={() => setSlippageOpen((v) => !v)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular-nums">{(slippageBps / 100).toFixed(1)}%</span>
            </button>

            {slippageOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setSlippageOpen(false)}
                  aria-hidden
                />
                <div className="absolute right-0 z-50 mt-2 w-40 rounded-card border border-gray-200 bg-white p-2 shadow-lg">
                  <div className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Max Slippage
                  </div>
                  {SLIPPAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.bps}
                      type="button"
                      onClick={() => {
                        setSlippageBps(opt.bps);
                        setSlippageOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-gray-100",
                        opt.bps === slippageBps
                          ? "text-accent-500"
                          : "text-gray-700",
                      )}
                    >
                      <span className="tabular-nums">{opt.label}</span>
                      {opt.bps === slippageBps && (
                        <Check className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="relative flex flex-col gap-1">
          <SwapInputPanel
            label="You Pay"
            token={payToken}
            value={amount}
            onValueChange={handleAmountChange}
            onSelectToken={() => setSelector("pay")}
            bottomLeft={
              isConnected ? (
                <span className="tabular-nums">
                  Balance: {balance.formatted}
                </span>
              ) : null
            }
            bottomRight={
              <button
                type="button"
                onClick={handleMax}
                disabled={!isConnected || balance.raw === "0"}
                className="font-semibold text-accent-500 transition-colors hover:text-accent-400 disabled:text-gray-400"
              >
                Max
              </button>
            }
          />

          <SwapInputPanel
            label="You Receive"
            token={receiveToken}
            value={receiveValue}
            readOnly
            loading={quote.isLoading}
            onSelectToken={() => setSelector("receive")}
            bottomLeft={receiveHint}
            bottomRight={
              quote.quote?.usdValue ? (
                <span className="tabular-nums">{quote.quote.usdValue}</span>
              ) : null
            }
          />

          <button
            type="button"
            onClick={swapTokens}
            disabled={sameToken}
            aria-label="Swap tokens"
            className={cn(
              "absolute left-1/2 top-1/2 z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2",
              "items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 shadow-sm",
              "transition-colors hover:bg-gray-100 hover:text-gray-950",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <ArrowUpDown className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <QuoteDetails
          quote={quote.quote}
          loading={quote.isLoading}
          hasAmount={hasAmount}
          notAvailable={quote.notAvailable}
        />

        <RouteDetails
          quote={quote.quote}
          open={routeOpen}
          onToggle={() => setRouteOpen((v) => !v)}
        />

        <SwapButton state={state} />
      </Card>

      <TokenSelector
        open={selector !== null}
        onClose={() => setSelector(null)}
        onSelect={handleSelect}
        selectedAddress={
          selector === "pay" ? payToken.address : receiveToken.address
        }
      />
    </>
  );
}
