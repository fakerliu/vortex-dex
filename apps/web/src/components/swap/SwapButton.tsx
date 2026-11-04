"use client";

import { useConnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/Button";
import { SWAP_BUTTON_LABELS, type SwapButtonState } from "./swapState";

/**
 * 主操作按钮状态机：
 * 未连接 → Connect Wallet；未输入 → Enter Amount；Token 相同 → Select Different Token；
 * 余额不足 → Insufficient Balance；报价加载 → Getting Quote...；
 * 网络错误 → Switch Network；需要授权 → Approve Token；已授权 → Review Swap。
 *
 * review / approve 分支通过 onReview / onApprove 回调交给上层（打开 ReviewSwapModal / 触发执行）。
 */
export function SwapButton({
  state,
  onReview,
  onApprove,
}: {
  state: SwapButtonState;
  onReview?: () => void;
  onApprove?: () => void;
}) {
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();

  const handleClick = () => {
    if (state.kind === "connect") {
      const connector = connectors[0];
      if (connector) connect({ connector });
      return;
    }
    if (state.kind === "switch-network") {
      switchChain({ chainId: state.chainId });
      return;
    }
    if (state.kind === "review") {
      onReview?.();
      return;
    }
    if (state.kind === "approve") {
      onApprove?.();
      return;
    }
  };

  const actionable =
    state.kind === "connect" ||
    state.kind === "switch-network" ||
    state.kind === "review" ||
    state.kind === "approve";

  const loading =
    state.kind === "getting-quote" || state.kind === "approve";

  const muted =
    state.kind === "enter-amount" ||
    state.kind === "same-token" ||
    state.kind === "insufficient-balance" ||
    state.kind === "quote-unavailable" ||
    state.kind === "quote-error";

  return (
    <Button
      size="large"
      className="mt-4 w-full"
      variant={muted ? "secondary" : "primary"}
      disabled={!actionable}
      loading={loading}
      onClick={handleClick}
    >
      {SWAP_BUTTON_LABELS[state.kind]}
    </Button>
  );
}
