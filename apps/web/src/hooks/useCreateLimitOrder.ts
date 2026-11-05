"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useWalletClient } from "wagmi";
import {
  createLimitOrder,
  submitLimitOrderSignature,
} from "@/services/limit-order";
import type {
  CreateLimitOrderParams,
  LimitOrderDto,
  LimitOrderTransactionPayload,
} from "@/types/limit-order";

/**
 * 限价单下单阶段（前端状态机）。
 *
 *   idle ──start()──► creating ──► signing ──► submitting ──► done
 *     │                  │             │            │
 *     └──────────────────┴──── 任一阶段失败 ──► error
 *
 * 关键铁律：签名用 walletClient.signTransaction（只签名【不广播】），
 * 绝不用 sendTransaction（那会直接广播，违背「用户预签、keeper 广播」模型）。
 */
export type CreateLimitOrderPhase =
  | "idle"
  | "creating"
  | "signing"
  | "submitting"
  | "done"
  | "error";

export interface CreateLimitOrderState {
  phase: CreateLimitOrderPhase;
  order: LimitOrderDto | null;
  error: string | null;
  /** 当前签名步骤提示（如 "Sign approval (1/2)"）。 */
  signingStep: string | null;
}

export interface UseCreateLimitOrderResult extends CreateLimitOrderState {
  /** 是否正在执行中（不可重复触发）。 */
  busy: boolean;
  /** 是否已成功挂单。 */
  done: boolean;
  /** 触发完整链路：下单 → 预签（approve? + swap）→ 提交签名。 */
  start: (params: CreateLimitOrderParams) => Promise<void>;
  /** 重置到 idle。 */
  reset: () => void;
}

/** 判断是否用户拒绝签名（MetaMask 4001 / viem UserRejectedRequestError）。 */
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
 * 限价单下单 orchestration hook。
 * 只负责：下单拿 signingPayload → 依次 signTransaction → 提交签名武装订单。
 */
export function useCreateLimitOrder(): UseCreateLimitOrderResult {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<CreateLimitOrderPhase>("idle");
  const [order, setOrder] = useState<LimitOrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingStep, setSigningStep] = useState<string | null>(null);

  const busy = phase !== "idle" && phase !== "done" && phase !== "error";
  const done = phase === "done";

  const fail = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
    setPhase("error");
    setSigningStep(null);
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setOrder(null);
    setError(null);
    setSigningStep(null);
  }, []);

  const signTransaction = useCallback(
    async (tx: LimitOrderTransactionPayload, chainId: number): Promise<string> => {
      if (!walletClient) {
        throw new Error("Wallet is not connected.");
      }
      if (typeof walletClient.signTransaction !== "function") {
        throw new Error(
          "Your wallet does not support signing raw transactions (eth_signTransaction).",
        );
      }
      // 只签名，不广播：返回 raw signed tx hex，交由后端 keeper 广播。
      return walletClient.signTransaction({
        account: address as `0x${string}`,
        chainId,
        to: tx.to as `0x${string}`,
        value: BigInt(tx.value || "0"),
        data: tx.data as `0x${string}`,
        nonce: tx.nonce,
        gas: BigInt(tx.gasLimit || "0"),
        maxFeePerGas: BigInt(tx.maxFeePerGas || "0"),
        maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas || "0"),
        type: "eip1559",
      });
    },
    [walletClient, address],
  );

  const start = useCallback(
    async (params: CreateLimitOrderParams) => {
      if (!address) {
        setError("Connect your wallet first.");
        setPhase("error");
        return;
      }

      setPhase("creating");
      setError(null);
      setOrder(null);
      setSigningStep(null);

      try {
        // 1. 下单，拿待签交易清单（后端已补 nonce/gas）。
        const result = await createLimitOrder(params);
        setOrder(result.order);
        setPhase("signing");

        const txs = result.signingPayload.transactions;
        const approvalTx = txs.find((t) => t.kind === "approve");
        const swapTx = txs.find((t) => t.kind === "swap");
        if (!swapTx) {
          throw new Error("Backend returned no swap transaction to sign.");
        }

        // 2. 依次签名：先 approve（如有）后 swap，nonce 连续。
        let signedApprovalTx: string | undefined;
        if (approvalTx) {
          setSigningStep("Sign approval (1/2)");
          signedApprovalTx = await signTransaction(
            approvalTx,
            result.signingPayload.chainId,
          );
        }

        setSigningStep(approvalTx ? "Sign swap (2/2)" : "Sign swap transaction");
        const signedSwapTx = await signTransaction(
          swapTx,
          result.signingPayload.chainId,
        );

        // 3. 提交签名，武装订单（armed）。
        setPhase("submitting");
        setSigningStep(null);
        const updated = await submitLimitOrderSignature(result.order.id, {
          userAddress: params.userAddress,
          ...(signedApprovalTx ? { signedApprovalTx } : {}),
          signedSwapTx,
        });

        setOrder(updated);
        setPhase("done");
        void queryClient.invalidateQueries({ queryKey: ["limit-orders"] });
      } catch (err) {
        if (isUserRejected(err)) {
          setError("Signature rejected. Please try again.");
        } else {
          fail(err);
        }
      }
    },
    [address, signTransaction, queryClient, fail],
  );

  return {
    phase,
    order,
    error,
    signingStep,
    busy,
    done,
    start,
    reset,
  };
}
