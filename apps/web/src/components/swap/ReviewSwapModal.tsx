"use client";

import { useMemo } from "react";
import { Check, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import type { Token } from "@/types/token";
import type { UseSwapExecutionResult } from "@/hooks/useSwapExecution";
import { truncateAddress, formatTokenAmount } from "@/utils/format";

/** 区块浏览器链接（按 chainId）。 */
function explorerUrl(chainId: number, hash: string): string {
  const host =
    chainId === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
  return `${host}/tx/${hash}`;
}

/** 交易步骤可视化的状态。 */
type StepStatus = "pending" | "active" | "done" | "error";

/** 交易步骤可视化：pending / active / done / error 四种状态。 */
function StepRow({
  label,
  sub,
  status,
}: {
  label: string;
  sub?: string;
  status: StepStatus;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
        {status === "done" ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-white">
            <Check className="h-3 w-3" aria-hidden />
          </span>
        ) : status === "active" ? (
          <Loader2 className="h-5 w-5 animate-spin text-accent-500" aria-hidden />
        ) : status === "error" ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white">
            <ShieldAlert className="h-3 w-3" aria-hidden />
          </span>
        ) : (
          <span className="h-5 w-5 rounded-full border-2 border-gray-300" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm font-medium",
            status === "pending" ? "text-gray-400" : "text-gray-800",
          )}
        >
          {label}
        </div>
        {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 tabular-nums">{value}</span>
    </div>
  );
}

export function ReviewSwapModal({
  open,
  onClose,
  execution,
  payToken,
  receiveToken,
}: {
  open: boolean;
  onClose: () => void;
  execution: UseSwapExecutionResult;
  payToken: Token;
  receiveToken: Token;
}) {
  const { phase, prepared, approveTxHash, swapTxHash, error, busy, done } =
    execution;

  const needsApproval = prepared?.needsApproval ?? false;

  // approve 步骤状态
  const approveStatus: StepStatus = useMemo(() => {
    if (!needsApproval) return "pending";
    if (approveTxHash && (phase === "swapping" || phase === "broadcasting" || phase === "submitting" || phase === "done"))
      return "done";
    if (phase === "approving" || phase === "approve-confirming") return "active";
    if (phase === "needs-approval") return "pending";
    return "pending";
  }, [needsApproval, approveTxHash, phase]);

  // swap 步骤状态
  const swapStatus: StepStatus = useMemo(() => {
    if (phase === "done") return "done";
    if (
      phase === "swapping" ||
      phase === "broadcasting" ||
      phase === "submitting"
    )
      return "active";
    if (phase === "error") return "error";
    return "pending";
  }, [phase]);

  const canClose = !busy;

  const isApproveStep = phase === "needs-approval";
  const isConfirmStep = phase === "swapping";
  const showSummary =
    prepared &&
    (phase === "needs-approval" ||
      phase === "swapping" ||
      phase === "broadcasting" ||
      phase === "submitting" ||
      phase === "done" ||
      phase === "error" ||
      phase === "approving" ||
      phase === "approve-confirming");

  return (
    <Modal
      open={open}
      onClose={canClose ? onClose : () => {}}
      title="Review Swap"
      hideClose={!canClose}
    >
      <div className="flex flex-col gap-4">
        {/* 交易摘要 */}
        {showSummary && prepared && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <SummaryRow
              label="You Pay"
              value={`${formatTokenAmount(prepared.amountIn, payToken.decimals)} ${payToken.symbol}`}
            />
            <SummaryRow
              label="You Receive"
              value={`${formatTokenAmount(prepared.amountOut, receiveToken.decimals)} ${receiveToken.symbol}`}
            />
            <SummaryRow
              label="Minimum Received"
              value={`${formatTokenAmount(prepared.minimumReceived, receiveToken.decimals)} ${receiveToken.symbol}`}
            />
            <SummaryRow
              label="Slippage"
              value={`${(prepared.slippageBps / 100).toFixed(2)}%`}
            />
            <SummaryRow
              label="Route"
              value={`${prepared.protocol} · ${prepared.route.length} hop${prepared.route.length > 1 ? "s" : ""}`}
            />
          </div>
        )}

        {/* 步骤 */}
        {prepared && (
          <div className="flex flex-col gap-3">
            {needsApproval && (
              <StepRow
                label="Approve token spending"
                sub={
                  approveTxHash
                    ? `Approved · ${truncateAddress(approveTxHash)}`
                    : `Allow the router to spend ${payToken.symbol}`
                }
                status={approveStatus}
              />
            )}
            <StepRow
              label="Confirm swap"
              sub={
                swapTxHash
                  ? `Submitted · ${truncateAddress(swapTxHash)}`
                  : "Sign the transaction in your wallet"
              }
              status={swapStatus}
            />
          </div>
        )}

        {/* 错误 */}
        {phase === "error" && error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* 成功态：txHash + 浏览器链接 */}
        {done && swapTxHash && prepared && (
          <a
            href={explorerUrl(prepared.chainId, swapTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success hover:bg-success/15"
          >
            View on Basescan
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}

        {/* 操作按钮 */}
        <div className="mt-2 flex flex-col gap-2">
          {isApproveStep && (
            <Button
              size="large"
              className="w-full"
              onClick={execution.confirmApprove}
            >
              Approve {payToken.symbol}
            </Button>
          )}

          {isConfirmStep && (
            <Button
              size="large"
              className="w-full"
              onClick={execution.confirmSwap}
            >
              Confirm Swap
            </Button>
          )}

          {(phase === "error" || done) && (
            <Button
              size="large"
              variant="secondary"
              className="w-full"
              onClick={() => {
                execution.reset();
                onClose();
              }}
            >
              Close
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
