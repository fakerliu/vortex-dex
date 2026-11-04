/**
 * 问题诊断类型（与后端 diagnosis.service.ts 对齐）。
 */

export interface TraceResult {
  found: boolean;
  intentId: string;
  intent?: {
    walletAddress: string | null;
    chainId: number | null;
    tokenIn: string | null;
    tokenOut: string | null;
    amountIn: string | null;
    status: string;
    startedAt: string;
    completedAt: string | null;
  };
  funnelProgress?: {
    reachedStep: number;
    reachedStepName: string;
    totalSteps: number;
  };
  steps?: Array<{ step: number; name: string; status: string }>;
  quotes?: Array<{
    quoteId: string;
    amountIn: string;
    amountOut: string;
    priceImpact: string;
    protocol: string | null;
    responseMs: number | null;
    createdAt: string;
  }>;
  routes?: Array<{
    routeId: string;
    protocolPath: string;
    poolPath: string;
    amountOut: string;
    netOutput: string;
    priceImpact: string;
    isSelected: boolean;
    computeMs: number | null;
  }>;
  swaps?: Array<{
    swapId: string;
    txHash: string;
    status: string;
    amountIn: string;
    amountOut: string;
    failureReason: string | null;
    gasUsed: string | null;
    effectiveGasPrice: string | null;
    createdAt: string;
    confirmedAt: string | null;
  }>;
  errors?: Array<{
    errorCode: string;
    errorType: string;
    message: string | null;
    service: string | null;
    createdAt: string;
  }>;
  diagnosis?: {
    level: string;
    summary: string;
    reasons: string[];
  };
}

export interface IntentsResult {
  generatedAt: string;
  total: number;
  intents: Array<{
    intent_id: string;
    wallet_address: string | null;
    chain_id: number | null;
    token_in: string | null;
    token_out: string | null;
    status: string;
    started_at: string;
    completed_at: string | null;
  }>;
}

export interface FailuresResult {
  generatedAt: string;
  total: number;
  failures: Array<{
    swapId: string;
    intentId: string | null;
    txHash: string;
    userAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    status: string;
    failureReason: string | null;
    gasUsed: string | null;
    createdAt: string;
  }>;
}
