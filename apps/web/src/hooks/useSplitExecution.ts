"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
} from "wagmi";
import type { Token } from "@/types/token";
import type { SplitOrderDetail, SplitPrepareResult } from "@/types/split";
import { isTerminalSplitOrderStatus } from "@/types/split";
import {
  getSplitOrder,
  prepareSplit,
  submitSplitChild,
} from "@/services/swap";
import { createIntentId, trackEvent } from "@/lib/analytics";

/**
 * 拆单执行阶段（前端状态机）。
 *
 *  idle ──prepare()──► preparing ──► preview ──execute()──► executing ──► done
 *    任一阶段失败 ──► error；用户拒绝签名/广播时回退到 preview 可重试。
 * done 后自动轮询 GET /swaps/split/:id，展示子单链上确认状态直至母单终态。
 */
export type SplitExecutionPhase =
  | "idle"
  | "preparing"
  | "preview"
  | "executing"
  | "done"
  | "error";

/** 单个授权 / 子单的进度状态。 */
export type SplitItemStatus = "pending" | "active" | "done" | "error";

export interface SplitApprovalProgress {
  spender: string;
  status: SplitItemStatus;
  txHash?: string;
}

export interface SplitChildProgress {
  index: number;
  status: SplitItemStatus;
  txHash?: string;
}

export interface UseSplitExecutionResult {
  phase: SplitExecutionPhase;
  /** split/prepare 结果（母单 + N 子单 + 聚合授权）。 */
  prepared: SplitPrepareResult | null;
  /** 各聚合授权的执行进度（仅含 needed=true）。 */
  approvals: SplitApprovalProgress[];
  /** 各子单的广播/回写进度。 */
  children: SplitChildProgress[];
  /** 母单详情（done 后轮询刷新）。 */
  orderDetail: SplitOrderDetail | null;
  /** 是否执行中（不可关闭 / 不可重复触发）。 */
  busy: boolean;
  /** 是否需要授权（preview 阶段展示用）。 */
  needsApproval: boolean;
  /** 错误信息（phase === "error" 时）。 */
  error: string | null;
  /** 触发拆单准备。 */
  prepare: () => Promise<void>;
  /** 确认执行：聚合授权 → 逐条广播 → 逐条回写 → 轮询。 */
  execute: () => Promise<void>;
  /** 手动刷新母单进度。 */
  refresh: () => Promise<void>;
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
 * 拆单执行 hook（非托管）。
 *
 * 后端产出母单 + 各子单 calldata + 聚合授权 calldata，本 hook 只负责：
 * 1. prepare：调 split/prepare 拿最新拆单报价与已编码 calldata
 * 2. approve：按 spender 分组，每个不同 spender 签名一条聚合授权并等待确认
 * 3. broadcast：逐条广播子单，每条成功后调 submit-child 回写
 * 4. poll：done 后轮询 split/:id 展示子单链上确认状态
 *
 * 金额全程字符串/BigInt，无 Float；用户拒绝时回退到 preview 可重试。
 */
export function useSplitExecution(
  payToken: Token | null,
  receiveToken: Token | null,
  amountIn: string,
  slippageBps: number,
): UseSplitExecutionResult {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  const [phase, setPhase] = useState<SplitExecutionPhase>("idle");
  const [prepared, setPrepared] = useState<SplitPrepareResult | null>(null);
  const [approvals, setApprovals] = useState<SplitApprovalProgress[]>([]);
  const [children, setChildren] = useState<SplitChildProgress[]>([]);
  const [orderDetail, setOrderDetail] = useState<SplitOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);

  const busy = phase === "preparing" || phase === "executing";
  const needsApproval = useMemo(
    () => (prepared?.approvals.some((a) => a.needed) ?? false),
    [prepared],
  );

  const fail = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
    setPhase("error");
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setPrepared(null);
    setApprovals([]);
    setChildren([]);
    setOrderDetail(null);
    setError(null);
    setIntentId(null);
  }, []);

  /** 触发拆单准备。 */
  const prepare = useCallback(async () => {
    if (!address || !payToken || !receiveToken || amountIn === "0") {
      fail(new Error("Missing wallet or swap details."));
      return;
    }
    setPhase("preparing");
    setError(null);
    setPrepared(null);
    setApprovals([]);
    setChildren([]);
    setOrderDetail(null);

    const iid = createIntentId();
    setIntentId(iid);

    try {
      const result = await prepareSplit({
        chainId: payToken.chainId,
        userAddress: address.toLowerCase(),
        tokenIn: payToken.address,
        tokenOut: receiveToken.address,
        amountIn,
        slippageBps,
        intentId: iid,
      });
      setPrepared(result);
      setApprovals(
        result.approvals
          .filter((a) => a.needed)
          .map((a) => ({ spender: a.spender, status: "pending" as const })),
      );
      setChildren(
        result.splits.map((s) => ({
          index: s.index,
          status: "pending" as const,
        })),
      );

      trackEvent({
        eventName: "split_prepare",
        intentId: iid,
        walletAddress: address,
        chainId: result.chainId,
        properties: {
          tokenIn: result.tokenIn,
          tokenOut: result.tokenOut,
          amountIn: result.amountIn,
          childCount: result.splits.length,
          priceImpactAggregated: result.priceImpactAggregated,
        },
      });

      setPhase("preview");
    } catch (err) {
      fail(err);
    }
  }, [address, payToken, receiveToken, amountIn, slippageBps, fail]);

  /** 确认执行：聚合授权 → 逐条广播 → 逐条回写。 */
  const execute = useCallback(async () => {
    if (!prepared || !address) {
      fail(new Error("Nothing prepared to execute."));
      return;
    }
    setPhase("executing");
    setError(null);

    try {
      // 1. 聚合授权：每个 needed 的 spender 各签名一条 approve
      const neededApprovals = prepared.approvals.filter((a) => a.needed);
      for (let i = 0; i < neededApprovals.length; i++) {
        const approval = neededApprovals[i];
        setApprovals((prev) =>
          prev.map((x, idx) => (idx === i ? { ...x, status: "active" } : x)),
        );
        try {
          const hash = await sendTransactionAsync({
            to: approval.token as `0x${string}`,
            data: approval.data as `0x${string}`,
            value: 0n,
          });
          setApprovals((prev) =>
            prev.map((x, idx) =>
              idx === i ? { ...x, status: "active", txHash: hash } : x,
            ),
          );

          trackEvent({
            eventName: "wallet_signature",
            intentId: intentId ?? undefined,
            walletAddress: address,
            chainId: prepared.chainId,
            properties: { type: "approve", txHash: hash, spender: approval.spender },
          });

          await publicClient?.waitForTransactionReceipt({ hash });
          setApprovals((prev) =>
            prev.map((x, idx) =>
              idx === i ? { ...x, status: "done", txHash: hash } : x,
            ),
          );
        } catch (err) {
          if (isUserRejected(err)) throw err;
          setApprovals((prev) =>
            prev.map((x, idx) => (idx === i ? { ...x, status: "error" } : x)),
          );
          throw err;
        }
      }

      // 2. 逐条广播子单，每条成功后回写 submit-child
      for (let i = 0; i < prepared.splits.length; i++) {
        const split = prepared.splits[i];
        setChildren((prev) =>
          prev.map((x, idx) => (idx === i ? { ...x, status: "active" } : x)),
        );
        try {
          const tx = split.transaction;
          const hash = await sendTransactionAsync({
            to: tx.to as `0x${string}`,
            data: tx.data as `0x${string}`,
            value: BigInt(tx.value ?? "0"),
          });
          setChildren((prev) =>
            prev.map((x, idx) =>
              idx === i ? { ...x, status: "active", txHash: hash } : x,
            ),
          );

          trackEvent({
            eventName: "transaction_submitted",
            intentId: intentId ?? undefined,
            walletAddress: address,
            chainId: prepared.chainId,
            properties: { txHash: hash, splitChildIndex: split.index },
          });

          // 广播后立即回写，不等待链上确认
          await submitSplitChild(prepared.splitOrderId, {
            childIndex: split.index,
            txHash: hash,
            amountOut: split.amountOut,
          });
          setChildren((prev) =>
            prev.map((x, idx) =>
              idx === i ? { ...x, status: "done", txHash: hash } : x,
            ),
          );
        } catch (err) {
          if (isUserRejected(err)) throw err;
          setChildren((prev) =>
            prev.map((x, idx) => (idx === i ? { ...x, status: "error" } : x)),
          );
          throw err;
        }
      }

      // 3. 全部广播回写完成，进入轮询态
      setPhase("done");
    } catch (err) {
      if (isUserRejected(err)) {
        // 用户拒绝，回退到 preview 可重试
        setPhase("preview");
        return;
      }
      fail(err);
    }
  }, [prepared, address, sendTransactionAsync, publicClient, intentId, fail]);

  /** 手动刷新母单进度。 */
  const refresh = useCallback(async () => {
    if (!prepared) return;
    try {
      const detail = await getSplitOrder(prepared.splitOrderId);
      setOrderDetail(detail);
      setChildren((prev) =>
        prev.map((c) => {
          const child = detail.children.find((d) => d.index === c.index);
          if (!child) return c;
          return {
            ...c,
            txHash: child.txHash ?? c.txHash,
            status:
              child.status === "confirmed"
                ? "done"
                : child.status === "failed"
                  ? "error"
                  : c.status,
          };
        }),
      );
    } catch {
      // 轮询失败静默，下一轮重试
    }
  }, [prepared]);

  // done 后自动轮询子单链上确认状态，直至母单终态
  useEffect(() => {
    if (phase !== "done" || !prepared) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const detail = await getSplitOrder(prepared.splitOrderId);
        if (cancelled) return;
        setOrderDetail(detail);
        setChildren((prev) =>
          prev.map((c) => {
            const child = detail.children.find((d) => d.index === c.index);
            if (!child) return c;
            return {
              ...c,
              txHash: child.txHash ?? c.txHash,
              status:
                child.status === "confirmed"
                  ? "done"
                  : child.status === "failed"
                    ? "error"
                    : c.status,
            };
          }),
        );
        if (isTerminalSplitOrderStatus(detail.status) && timer) {
          clearInterval(timer);
        }
      } catch {
        // 静默，下一轮重试
      }
    };

    void tick();
    timer = setInterval(tick, 4000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [phase, prepared]);

  return {
    phase,
    prepared,
    approvals,
    children,
    orderDetail,
    busy,
    needsApproval,
    error,
    prepare,
    execute,
    refresh,
    reset,
  };
}
