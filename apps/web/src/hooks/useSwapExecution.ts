"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
} from "wagmi";
import type { PrepareSwapResult } from "@/types/swap";
import { prepareSwap, submitSwap } from "@/services/swap";
import type { Token } from "@/types/token";

/**
 * 交易执行阶段（前端状态机）。
 *
 *  idle ──start()──► preparing ──► needs-approval ──► approving ──► approve-confirming
 *    │                    │                                     │
 *    │                    └────────（无需 approve）────────────► swapping
 *    │                                                          │
 *    └────────────── reset() 任意阶段回退 ───────────────────────┘
 *    swapping ──► broadcasting ──► submitting ──► done
 *    任一阶段失败 ──► error
 */
export type SwapExecutionPhase =
  | "idle"
  | "preparing"
  | "needs-approval"
  | "approving"
  | "approve-confirming"
  | "swapping"
  | "broadcasting"
  | "submitting"
  | "done"
  | "error";

export interface SwapExecutionState {
  phase: SwapExecutionPhase;
  /** prepare 结果（含已编码 calldata）。 */
  prepared: PrepareSwapResult | null;
  /** approve 交易哈希。 */
  approveTxHash: string | null;
  /** swap 交易哈希。 */
  swapTxHash: string | null;
  /** 后端回写后的交易记录（含 id）。 */
  record: { id: string; status: string } | null;
  /** 错误信息（phase === "error" 时）。 */
  error: string | null;
}

export interface UseSwapExecutionResult extends SwapExecutionState {
  /** 是否正在执行中（不可关闭/不可重复触发）。 */
  busy: boolean;
  /** 是否已成功完成。 */
  done: boolean;
  /** 触发执行：prepare →（approve）→ swap → submit。 */
  start: () => Promise<void>;
  /** 用户确认 approve（在 needs-approval 阶段点击「Approve」后调用）。 */
  confirmApprove: () => Promise<void>;
  /** 用户确认 swap（在 needs-approval 通过后 / 无需 approve 时点击「Confirm Swap」）。 */
  confirmSwap: () => Promise<void>;
  /** 重置到 idle。 */
  reset: () => void;
}

/** 判断是否用户拒绝签名/交易（MetaMask 4001 / viem UserRejectedRequestError）。 */
function isUserRejected(err: unknown): boolean {
  const e = err as {
    code?: number | string;
    name?: string;
    message?: string;
    cause?: { code?: number | string; name?: string };
  };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.name ?? e?.cause?.name;
  return (
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    name === "UserRejectedRequestError" ||
    /user rejected|rejected the request|cancelled/i.test(e?.message ?? "")
  );
}

/**
 * 交易执行 hook（非托管）。
 *
 * 后端产出 calldata，本 hook 只负责：
 * 1. prepare：拿最新报价 + 已编码 swap/approve calldata
 * 2. approve：如需授权，用后端给的 approve calldata 广播（目标=token 合约）
 * 3. swap：用后端给的 swap calldata 广播（目标=Router）
 * 4. submit：拿到 swap txHash 后回写后端（状态 PENDING）
 *
 * 金额全程字符串/BigInt，无 Float；用户拒绝时回退到可重试状态。
 */
export function useSwapExecution(
  payToken: Token | null,
  receiveToken: Token | null,
  amountIn: string,
  slippageBps: number,
): UseSwapExecutionResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  const [phase, setPhase] = useState<SwapExecutionPhase>("idle");
  const [prepared, setPrepared] = useState<PrepareSwapResult | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);
  const [record, setRecord] = useState<{ id: string; status: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const busy = useMemo(
    () =>
      phase !== "idle" &&
      phase !== "done" &&
      phase !== "error" &&
      phase !== "needs-approval",
    [phase],
  );
  const done = phase === "done";

  const fail = useCallback((err: unknown) => {
    const message =
      err instanceof Error ? err.message : String(err);
    setError(message);
    setPhase("error");
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setPrepared(null);
    setApproveTxHash(null);
    setSwapTxHash(null);
    setRecord(null);
    setError(null);
  }, []);

  /** 触发 prepare。 */
  const start = useCallback(async () => {
    if (!address || !payToken || !receiveToken || amountIn === "0") {
      setError("Missing wallet or swap details.");
      setPhase("error");
      return;
    }
    setPhase("preparing");
    setError(null);
    setPrepared(null);
    setApproveTxHash(null);
    setSwapTxHash(null);
    setRecord(null);

    try {
      const result = await prepareSwap({
        tokenIn: payToken.address,
        tokenOut: receiveToken.address,
        amountIn,
        userAddress: address.toLowerCase(),
        slippageBps,
        chainId: payToken.chainId,
      });
      setPrepared(result);
      setPhase(result.needsApproval ? "needs-approval" : "swapping");
    } catch (err) {
      fail(err);
    }
  }, [address, payToken, receiveToken, amountIn, slippageBps, fail]);

  /** 确认 approve：广播授权交易，等回执。 */
  const confirmApprove = useCallback(async () => {
    if (!prepared || !prepared.approval?.needed) {
      fail(new Error("No approval is required for this swap."));
      return;
    }
    setPhase("approving");
    setError(null);

    try {
      // 使用后端已编码的 approve calldata（目标 = tokenIn 合约）。
      // 走 sendTransactionAsync 而非 writeContract，忠实于「后端产出 calldata、前端广播」的分工，
      // 且对非标准 ERC20（如 USDT）也无需前端维护 ABI 差异。
      const approveHash = await sendTransactionAsync({
        to: prepared.approval.token as `0x${string}`,
        data: prepared.approval.data as `0x${string}`,
        value: 0n,
      });
      setApproveTxHash(approveHash);

      setPhase("approve-confirming");
      await publicClient?.waitForTransactionReceipt({ hash: approveHash });

      // 授权确认后进入 swap 待确认态
      setPhase("swapping");
    } catch (err) {
      if (isUserRejected(err)) {
        setPhase("needs-approval");
        return;
      }
      fail(err);
    }
  }, [prepared, sendTransactionAsync, publicClient, fail]);

  /** 确认 swap：广播交易，等回执，回写后端。 */
  const confirmSwap = useCallback(async () => {
    if (!prepared || !address) {
      fail(new Error("Nothing prepared to execute."));
      return;
    }
    setPhase("broadcasting");
    setError(null);

    try {
      const tx = prepared.transaction;
      // 已编码的 Router calldata，直接 sendTransaction。
      const hash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value ?? "0"),
      });
      setSwapTxHash(hash);

      setPhase("submitting");
      // 回写后端（非托管：只传公开 txHash + 元数据）。广播后立即回写，不等待链上确认。
      const saved = await submitSwap({
        txHash: hash,
        userAddress: address.toLowerCase(),
        tokenIn: prepared.tokenIn,
        tokenOut: prepared.tokenOut,
        amountIn: prepared.amountIn,
        amountOut: prepared.amountOut,
        chainId: prepared.chainId,
        status: "PENDING",
      });
      setRecord({ id: saved.id, status: saved.status });
      setPhase("done");
    } catch (err) {
      if (isUserRejected(err)) {
        // 用户拒绝广播 swap，回到待确认态。
        setPhase("swapping");
        return;
      }
      fail(err);
    }
  }, [prepared, address, sendTransactionAsync, fail]);

  return {
    phase,
    prepared,
    approveTxHash,
    swapTxHash,
    record,
    error,
    busy,
    done,
    start,
    confirmApprove,
    confirmSwap,
    reset,
  };
}
