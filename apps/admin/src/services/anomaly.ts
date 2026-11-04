import type {
  EventsResult,
  RulesResult,
  ScanResult,
} from "@/types/anomaly";
import { apiBase } from "./dashboard";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
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

export function getRules(): Promise<RulesResult> {
  return request<RulesResult>(`/analytics/anomaly/rules`);
}

export function scan(): Promise<ScanResult> {
  return request<ScanResult>(`/analytics/anomaly/scan`, { method: "POST" });
}

export function seedRules(): Promise<{ seeded: number }> {
  return request<{ seeded: number }>(`/analytics/anomaly/seed`, { method: "POST" });
}

export function getEvents(status?: string): Promise<EventsResult> {
  const qs = status ? `?status=${status}` : "";
  return request<EventsResult>(`/analytics/anomaly/events${qs}`);
}

export function resolveEvent(
  id: string,
  status: "acknowledged" | "resolved",
): Promise<unknown> {
  return request(`/analytics/anomaly/events/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function toggleRule(id: string, isEnabled: boolean): Promise<unknown> {
  return request(`/analytics/anomaly/rules/${id}/toggle`, {
    method: "POST",
    body: JSON.stringify({ isEnabled }),
  });
}
