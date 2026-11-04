/**
 * 系统监控类型（与后端 monitor.service.ts 对齐）。
 */

export interface HealthResult {
  generatedAt: string;
  database: string;
  indexer: {
    chainId: number;
    lastSyncedBlock: number;
    running: boolean;
  };
  errors24h: {
    total: number;
    technical: number;
    business: number;
  };
  errorRate24h: string;
  metrics24h: number;
  note: string;
}

export interface ServiceMetric {
  name: string;
  unit: string | null;
  avg: string;
  max: string;
  samples: number;
}

export interface ServicesResult {
  generatedAt: string;
  window: string;
  services: Array<{
    service: string;
    metrics: ServiceMetric[];
  }>;
  note: string;
}

export interface ErrorsResult {
  generatedAt: string;
  window: string;
  chainId: number | null;
  total: number;
  topErrors: Array<{
    errorCode: string;
    type: string;
    count: number;
  }>;
  note: string;
}
