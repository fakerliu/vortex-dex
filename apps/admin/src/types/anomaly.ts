/**
 * 异常中心类型（与后端 anomaly.service.ts 对齐）。
 */

export interface AlertRule {
  id: string;
  name: string;
  metric_name: string;
  operator: string;
  threshold: string;
  window_minutes: number;
  severity: string;
  is_enabled: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface RulesResult {
  generatedAt: string;
  rules: AlertRule[];
}

export interface AnomalyEvent {
  id: string;
  rule_id: string | null;
  rule_name: string;
  metric_name: string;
  metric_value: string;
  threshold: string;
  severity: string;
  status: string;
  message: string | null;
  context: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface EventsResult {
  generatedAt: string;
  openCount: number;
  total: number;
  events: AnomalyEvent[];
}

export interface ScanResult {
  scannedRules: number;
  triggered: number;
  anomalies: Array<{
    ruleName: string;
    metricValue: string;
    severity: string;
  }>;
}
