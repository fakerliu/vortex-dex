import type { SupportedChainId } from "@/config/chains";

export type SwapButtonState =
  | { kind: "connect" }
  | { kind: "switch-network"; chainId: SupportedChainId }
  | { kind: "enter-amount" }
  | { kind: "same-token" }
  | { kind: "insufficient-balance" }
  | { kind: "getting-quote" }
  | { kind: "quote-unavailable" }
  | { kind: "quote-error" }
  | { kind: "approve" }
  | { kind: "review" };

export const SWAP_BUTTON_LABELS: Record<SwapButtonState["kind"], string> = {
  connect: "Connect Wallet",
  "switch-network": "Switch Network",
  "enter-amount": "Enter Amount",
  "same-token": "Select Different Token",
  "insufficient-balance": "Insufficient Balance",
  "getting-quote": "Getting Quote...",
  "quote-unavailable": "Quote Engine Not Connected",
  "quote-error": "Quote Failed",
  approve: "Approve Token",
  review: "Review Swap",
};
