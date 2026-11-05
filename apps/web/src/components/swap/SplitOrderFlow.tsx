"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Token } from "@/types/token";
import {
  useSplitExecution,
  type SplitItemStatus,
} from "@/hooks/useSplitExecution";
import {
  formatTokenAmount,
  priceImpactToPercent,
  truncateAddress,
} from "@/utils/format";

/** 协议类型展示文案。 */
function protocolLabel(protocolType: string): string {
  switch (protocolType.toLowerCase()) {
    case "aerodrome_classic":
      return "Aerodrome Classic";
    case "aerodrome_cl":
      return "Aerodrome CL";
    case "uniswap_v3":
      return "Uniswap V3";
    default:
      return protocolType;
  }
}

/** 区块浏览器链接（按 chainId）。 */
function explorerUrl(chainId: number, hash: string): string {
  const host =
    chainId === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
  return `${host}/tx/${hash}`;
}

/** 子单/授权状态图标。 */
function StatusIcon({ status }: { status: SplitItemStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return (
      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent-500" aria-hidden />
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-white">
        <ShieldAlert className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  return (
    <span className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-300" />
  );
}

/**
 * 拆单流程弹窗：母单预览 → 聚合授权 → 逐条广播 → 进度追踪。
 * 打开即调 split/prepare，随后按用户确认执行聚合授权与逐条广播，done 后轮询进度。
 */
export function SplitOrderFlow({
  open,
  onClose,
  payToken,
  receiveToken,
  amountIn,
  slippageBps,
}: {
  open: boolean;
  onClose: () => void;
  payToken: Token;
  receiveToken: Token;
  amountIn: string;
  slippageBps: number;
}) {
  const execution = useSplitExecution(
    payToken,
    receiveToken,
    amountIn,
    slippageBps,
  );
  const { phase, prepared, approvals, children, orderDetail, busy, needsApproval, error } =
    execution;

  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      void execution.prepare();
    }
    if (!open && prevOpen.current) {
      execution.reset();
    }
    prevOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canClose = !busy;
  const isPreview = phase === "preview";
  const showChildrenProgress =
    phase === "executing" || phase === "done" || phase === "error";

  const doneAll = useMemo(
    () => children.length > 0 && children.every((c) => c.status === "done"),
    [children],
  );

  const terminalStatus = orderDetail?.status
    ? ["completed", "failed", "cancelled"].includes(orderDetail.status)
    : false;

  return (
    <Modal
      open={open}
      onClose={canClose ? onClose : () => {}}
      title="Split Order Routing"
      hideClose={!canClose}
    >
      <div className="flex flex-col gap-4">
        {/* 准备中 */}
        {phase === "preparing" && (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Preparing split route…
          </div>
        )}

        {/* 母单预览 */}
        {isPreview && prepared && (
          <>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <SummaryRow
                label="You Pay"
                value={`${formatTokenAmount(prepared.amountIn, payToken.decimals)} ${payToken.symbol}`}
              />
              <SummaryRow
                label="You Receive (total)"
                value={`${formatTokenAmount(prepared.amountOutTotal, receiveToken.decimals)} ${receiveToken.symbol}`}
              />
              <SummaryRow
                label="Aggregated Price Impact"
                value={`${priceImpactToPercent(prepared.priceImpactAggregated)}%`}
              />
              <SummaryRow
                label="Sub-orders"
                value={`${prepared.splits.length} route${prepared.splits.length > 1 ? "s" : ""}`}
              />
              {needsApproval && (
                <SummaryRow
                  label="Approvals"
                  value={`${prepared.approvals.filter((a) => a.needed).length} spender${prepared.approvals.filter((a) => a.needed).length > 1 ? "s" : ""}`}
                />
              )}
            </div>

            {prepared.notes.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{prepared.notes.join(" ")}</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Sub-orders
              </p>
              {prepared.splits.map((split) => (
                <div
                  key={split.index}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">
                      #{split.index} · {protocolLabel(split.protocolType)}
                    </span>
                    <span className="font-mono text-gray-500">
                      {truncateAddress(split.poolAddress)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-gray-600">
                    <span className="tabular-nums">
                      Pay {formatTokenAmount(split.amountIn, payToken.decimals)}{" "}
                      {payToken.symbol}
                    </span>
                    <span className="tabular-nums">
                      Receive {formatTokenAmount(split.amountOut, receiveToken.decimals)}{" "}
                      {receiveToken.symbol}
                    </span>
                  </div>
                  <div className="mt-0.5 text-gray-400">
                    Price impact {priceImpactToPercent(split.priceImpact)}%
                  </div>
                </div>
              ))}
            </div>

            <Button
              size="large"
              className="w-full"
              onClick={() => void execution.execute()}
            >
              {needsApproval ? "Approve & Execute" : "Execute Split Order"}
            </Button>
          </>
        )}

        {/* 执行进度 */}
        {showChildrenProgress && prepared && (
          <div className="flex flex-col gap-3">
            {needsApproval && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Approvals
                </p>
                {approvals.map((ap, i) => (
                  <div key={ap.spender} className="flex items-center gap-2 text-sm">
                    <StatusIcon status={ap.status} />
                    <span className="flex-1 text-gray-700">
                      Approve {payToken.symbol} · {truncateAddress(ap.spender)}
                    </span>
                    {ap.txHash && (
                      <a
                        href={explorerUrl(prepared.chainId, ap.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-accent-500"
                      >
                        {truncateAddress(ap.txHash)}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                    {i === approvals.length - 1 && ap.status === "done" && (
                      <span className="text-xs text-success">Done</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Sub-orders
              </p>
              {children.map((child) => {
                const split = prepared.splits.find((s) => s.index === child.index);
                return (
                  <div key={child.index} className="flex items-center gap-2 text-sm">
                    <StatusIcon status={child.status} />
                    <span className="flex-1 text-gray-700">
                      #{child.index} · {split ? protocolLabel(split.protocolType) : "—"}
                    </span>
                    {child.txHash && (
                      <a
                        href={explorerUrl(prepared.chainId, child.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-accent-500"
                      >
                        {truncateAddress(child.txHash)}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 轮询态提示 */}
            {phase === "done" && (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                {terminalStatus ? (
                  <>Split order <span className="font-medium text-gray-700">{orderDetail?.status}</span> — tracking on-chain confirmation…</>
                ) : doneAll ? (
                  <>All sub-orders submitted. Waiting for on-chain confirmation…</>
                ) : (
                  <>Sub-orders broadcast. Tracking on-chain confirmation…</>
                )}
              </div>
            )}
          </div>
        )}

        {/* 错误 */}
        {phase === "error" && error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* 底部操作 */}
        {(phase === "error" || phase === "done") && (
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
    </Modal>
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
