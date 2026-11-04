/**
 * Admin Dashboard 类型（与后端 dashboard.service.ts 对齐）。
 * 金额一律字符串；禁 Float。
 */

export interface OverviewResult {
  generatedAt: string;
  chainId: number | null;
  totalSwaps: number;
  confirmedSwaps: number;
  failedSwaps: number;
  uniqueUsers: number;
  activeWallets24h: number;
  successRate: string;
  volumeUsd: string;
  note: string;
}

export interface TradingResult {
  generatedAt: string;
  chainId: number | null;
  statusBreakdown: Record<string, number>;
  topPairs: Array<{
    tokenIn: string;
    tokenOut: string;
    swaps: number;
    amountIn: string;
    amountOut: string;
  }>;
}

export interface UsersResult {
  generatedAt: string;
  chainId: number | null;
  totalUsers: number;
  topWallets: Array<{
    wallet: string;
    swaps: number;
  }>;
}

export interface FunnelStep {
  step: number;
  name: string;
  count: number;
}

export interface FunnelResult {
  generatedAt: string;
  chainId: number | null;
  steps: FunnelStep[];
  note: string;
}
