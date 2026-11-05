"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ArrowUpDown, CheckCircle2, Clock, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SwapInputPanel } from "@/components/swap/SwapInputPanel";
import { TokenSelector } from "@/components/token/TokenSelector";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useCreateLimitOrder } from "@/hooks/useCreateLimitOrder";
import {
  getDefaultTokensForChain,
} from "@/config/tokens";
import { isSupportedChain } from "@/config/chains";
import {
  formatTokenAmount,
  isValidAmountInput,
  parseTokenAmount,
} from "@/utils/format";
import { deriveMinAmountOut } from "@/types/limit-order";
import type { Token } from "@/types/token";
import { cn } from "@/utils/cn";

/** 校验 limitPrice 是否为合法正十进制字符串。 */
function isValidLimitPrice(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return false;
  try {
    return parseTokenAmount(trimmed, 18) > 0n;
  } catch {
    return false;
  }
}

export function LimitOrderForm() {
  const { isConnected, chainId, address } = useAccount();
  const { switchChain } = useSwitchChain();

  const [payToken, setPayToken] = useState<Token>(
    getDefaultTokensForChain(8453).pay,
  );
  const [receiveToken, setReceiveToken] = useState<Token>(
    getDefaultTokensForChain(8453).receive,
  );
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selector, setSelector] = useState<"pay" | "receive" | null>(null);

  // 钱包切换网络时，重置 pay/receive 为该链默认代币。
  useEffect(() => {
    if (!chainId) return;
    const { pay, receive } = getDefaultTokensForChain(chainId);
    setPayToken(pay);
    setReceiveToken(receive);
    setAmount("");
    setLimitPrice("");
    setExpiresAt("");
  }, [chainId]);

  const balance = useTokenBalance(isConnected ? payToken : null);
  const create = useCreateLimitOrder();

  const parsedAmount = useMemo(() => {
    if (!amount || amount === ".") return 0n;
    try {
      return parseTokenAmount(amount, payToken.decimals);
    } catch {
      return 0n;
    }
  }, [amount, payToken.decimals]);

  const hasAmount = parsedAmount > 0n;
  const hasLimitPrice = isValidLimitPrice(limitPrice);
  const sameToken =
    payToken.address.toLowerCase() === receiveToken.address.toLowerCase();

  const minAmountOut = useMemo(() => {
    if (!hasAmount || !hasLimitPrice) return 0n;
    return deriveMinAmountOut(
      parsedAmount,
      limitPrice.trim(),
      payToken.decimals,
      receiveToken.decimals,
    );
  }, [hasAmount, hasLimitPrice, parsedAmount, limitPrice, payToken.decimals, receiveToken.decimals]);

  const receiveValue =
    hasAmount && hasLimitPrice && minAmountOut > 0n
      ? formatTokenAmount(minAmountOut, receiveToken.decimals)
      : "";

  const handleSelect = (token: Token) => {
    if (selector === "pay") setPayToken(token);
    else if (selector === "receive") setReceiveToken(token);
  };

  const swapTokens = () => {
    setPayToken(receiveToken);
    setReceiveToken(payToken);
    setAmount("");
    setLimitPrice("");
  };

  const handleMax = () => {
    if (!balance.raw || balance.raw === "0") return;
    setAmount(formatTokenAmount(balance.raw, payToken.decimals, payToken.decimals));
  };

  const buildButtonState = ():
    | { kind: "switch-network" }
    | { kind: "enter-amount" }
    | { kind: "same-token" }
    | { kind: "enter-limit-price" }
    | { kind: "insufficient-balance" }
    | { kind: "submit" } => {
    if (!isSupportedChain(chainId)) return { kind: "switch-network" };
    if (!hasAmount) return { kind: "enter-amount" };
    if (sameToken) return { kind: "same-token" };
    if (!hasLimitPrice) return { kind: "enter-limit-price" };
    if (
      !balance.isLoading &&
      !balance.isError &&
      parsedAmount > BigInt(balance.raw)
    ) {
      return { kind: "insufficient-balance" };
    }
    return { kind: "submit" };
  };

  const buttonState = buildButtonState();

  const buttonLabel: Record<ReturnType<typeof buildButtonState>["kind"], string> = {
    "switch-network": `Switch to ${payToken.chainId === 8453 ? "Base" : "Base Sepolia"}`,
    "enter-amount": "Enter an amount",
    "same-token": "Same token",
    "enter-limit-price": "Enter a limit price",
    "insufficient-balance": `Insufficient ${payToken.symbol} balance`,
    submit: "Place Limit Order",
  };

  const handleSubmit = async () => {
    if (buttonState.kind !== "submit" || !isConnected || !address) return;

    const params = {
      userAddress: address.toLowerCase(),
      chainId: payToken.chainId,
      tokenIn: payToken.address,
      tokenOut: receiveToken.address,
      amountIn: parsedAmount.toString(),
      limitPrice: limitPrice.trim(),
      direction: "buy" as const,
      ...(expiresAt.trim() ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    };
    await create.start(params);
  };

  return (
    <>
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">
            Limit Order
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-500">
            <Info className="h-3.5 w-3.5" aria-hidden />
            Buy
          </span>
        </div>

        <div className="relative flex flex-col gap-1">
          <SwapInputPanel
            label="You Pay"
            token={payToken}
            value={amount}
            onValueChange={(v) => {
              if (isValidAmountInput(v)) setAmount(v);
            }}
            onSelectToken={() => setSelector("pay")}
            bottomLeft={
              isConnected ? (
                <span className="tabular-nums">Balance: {balance.formatted}</span>
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
            label="You Buy (at limit)"
            token={receiveToken}
            value={receiveValue}
            readOnly
            onSelectToken={() => setSelector("receive")}
            bottomLeft={
              hasAmount && hasLimitPrice && minAmountOut > 0n
                ? "Minimum you will receive"
                : "Set amount + limit price"
            }
            bottomRight={null}
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

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">
              Limit price ({payToken.symbol} per {receiveToken.symbol})
            </label>
            <Input
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. 0.0004"
              endAdornment={
                <span className="text-sm text-gray-500">
                  {payToken.symbol}/{receiveToken.symbol}
                </span>
              }
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Fills when 1 {receiveToken.symbol} costs ≤ {limitPrice || "…"}{" "}
              {payToken.symbol}.
            </p>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Expires at (optional)
            </label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Leave empty for the default 7-day expiry.
            </p>
          </div>

          {create.error && (
            <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
              {create.error}
            </div>
          )}

          {create.done && create.order && (
            <div className="flex items-start gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <div className="font-medium">Limit order placed.</div>
                <div className="mt-0.5 text-xs text-gray-600">
                  Order {create.order.id.slice(0, 12)}… is now armed. The keeper
                  will fill it once the market reaches your limit price.
                </div>
              </div>
            </div>
          )}

          {create.signingStep && (
            <div className="text-sm text-gray-600">{create.signingStep}…</div>
          )}

          <Button
            onClick={() => {
              if (buttonState.kind === "switch-network") {
                switchChain({ chainId: payToken.chainId as 8453 | 84532 });
                return;
              }
              void handleSubmit();
            }}
            loading={create.busy}
            disabled={create.busy || (buttonState.kind !== "submit" && buttonState.kind !== "switch-network")}
          >
            {buttonLabel[buttonState.kind]}
          </Button>
        </div>
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
