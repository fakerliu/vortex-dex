"use client";

import { useState } from "react";
import { cn } from "@/utils/cn";

const FALLBACK_COLORS = [
  "#2F7CF6",
  "#16A36A",
  "#E5A33A",
  "#426D83",
  "#31556B",
  "#E05252",
  "#77818D",
];

function colorFor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function TokenIcon({
  logoURI,
  symbol,
  size = 24,
  className,
}: {
  logoURI?: string;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [error, setError] = useState(false);
  const showImage = Boolean(logoURI) && !error;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={logoURI}
          alt={symbol}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setError(true)}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-semibold text-white"
          style={{ backgroundColor: colorFor(symbol), fontSize: size * 0.42 }}
        >
          {symbol.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
