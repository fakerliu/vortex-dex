/**
 * DEX 专业分析类型（与后端 dex-analytics.service.ts 对齐）。
 * 金额一律字符串；禁 Float。
 */

export interface RoutesResult {
  generatedAt: string;
  chainId: number | null;
  totalRouteComputations: number;
  totalCandidates: number;
  selectedCandidates: number;
  selectionHitRate: string;
  avgCandidates: string;
  minCandidates: number;
  maxCandidates: number;
  avgComputeMs: number;
  maxComputeMs: number;
  p95ComputeMs: number;
  routeOptimizationGain: string;
  routeOptimizationGainPaths: number;
  note: string;
}

export interface ProtocolStat {
  protocol: string;
  totalCandidates: number;
  selectedCount: number;
  selectionRate: string;
  avgPriceImpact: string;
  avgNetOutput: string;
}

export interface ProtocolsResult {
  generatedAt: string;
  chainId: number | null;
  protocols: ProtocolStat[];
  note: string;
}

export interface PoolStat {
  pool: string;
  routedCount: number;
  selectedCount: number;
  selectionRate: string;
  liquidity: string | null;
}

export interface PoolsResult {
  generatedAt: string;
  chainId: number | null;
  topPools: PoolStat[];
  note: string;
}
