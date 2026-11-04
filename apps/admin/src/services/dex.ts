import type { PoolsResult, ProtocolsResult, RoutesResult } from "@/types/dex";
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

export function getRoutes(chainId?: number): Promise<RoutesResult> {
  const qs = chainId !== undefined ? `?chainId=${chainId}` : "";
  return get<RoutesResult>(`/analytics/dex/routes${qs}`);
}

export function getProtocols(chainId?: number): Promise<ProtocolsResult> {
  const qs = chainId !== undefined ? `?chainId=${chainId}` : "";
  return get<ProtocolsResult>(`/analytics/dex/protocols${qs}`);
}

export function getPools(chainId?: number): Promise<PoolsResult> {
  const qs = chainId !== undefined ? `?chainId=${chainId}` : "";
  return get<PoolsResult>(`/analytics/dex/pools${qs}`);
}
