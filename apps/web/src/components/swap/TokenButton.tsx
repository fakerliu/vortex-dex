"use client";

import { ChevronDown } from "lucide-react";
import { TokenIcon } from "@/components/token/TokenIcon";
import type { Token } from "@/types/token";

export function TokenButton({
  token,
  onClick,
}: {
  token: Token;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-300 bg-white px-2.5 py-2 transition-colors hover:bg-gray-100"
    >
      <TokenIcon logoURI={token.logoURI} symbol={token.symbol} size={24} />
      <span className="text-base font-semibold text-gray-950">{token.symbol}</span>
      <ChevronDown className="h-4 w-4 text-gray-500" aria-hidden />
    </button>
  );
}
