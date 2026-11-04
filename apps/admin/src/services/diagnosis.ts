import type {
  FailuresResult,
  IntentsResult,
  TraceResult,
} from "@/types/diagnosis";
import { apiBase } from "./dashboard";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
  let env: Envelope<T>;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok || !env.success || !env.data) {
    throw new Error(env.error?.message ?? `Request failed (HTTP ${res.status})`);
  }
  return env.data;
}

export function traceIntent(intentId: string): Promise<TraceResult> {
  return get<TraceResult>(`/analytics/diagnosis/intents/${intentId}`);
}

export function getIntents(status?: string): Promise<IntentsResult> {
  const qs = status ? `?status=${status}` : "";
  return get<IntentsResult>(`/analytics/diagnosis/intents${qs}`);
}

export function getFailures(): Promise<FailuresResult> {
  return get<FailuresResult>(`/analytics/diagnosis/failures`);
}
