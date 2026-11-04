/**
 * AI 分析类型（与后端 ai-analysis.service.ts 对齐）。
 */

export interface AiSummaryResult {
  generatedAt: string;
  report: string[];
  metrics: {
    totalSwaps: number;
    confirmedSwaps: number;
    successRate: string;
    uniqueUsers: number;
    openAnomalies: number;
    errorRate24h: string;
    selectionHitRate: string;
  };
}

export interface AiDiagnoseResult {
  found: boolean;
  intentId: string;
  report: string[] | string;
  diagnosis?: {
    level: string;
    summary: string;
    reasons: string[];
  };
}
