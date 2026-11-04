import type { ErrorsResult, HealthResult, ServicesResult } from "@/types/monitor";
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

export function getHealth(): Promise<HealthResult> {
  return get<HealthResult>(`/analytics/monitor/health`);
}

export function getServices(): Promise<ServicesResult> {
  return get<ServicesResult>(`/analytics/monitor/services`);
}

export function getErrors(type?: string): Promise<ErrorsResult> {
  const qs = type ? `?type=${type}` : "";
  return get<ErrorsResult>(`/analytics/monitor/errors${qs}`);
}
