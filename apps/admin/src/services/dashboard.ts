import type {
  FunnelResult,
  OverviewResult,
  TradingResult,
  UsersResult,
} from "@/types/dashboard";

/** 后端 API 基地址。 */
export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    throw new Error("Backend API is not configured (NEXT_PUBLIC_API_BASE_URL).");
  }
  return base.replace(/\/+$/, "");
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function get<T>(
  path: string,
  headers?: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      headers: { "Content-Type": "application/json", ...headers },
    });
  } catch (err) {
    throw new ApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      0,
    );
  }

  let env: Envelope<T>;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError("BAD_RESPONSE", `Non-JSON response (HTTP ${res.status})`, res.status);
  }

  if (!res.ok || !env.success || !env.data) {
    throw new ApiError(
      env.error?.code ?? "UNKNOWN_ERROR",
      env.error?.message ?? `Request failed (HTTP ${res.status})`,
      res.status,
    );
  }
  return env.data;
}

export function getOverview(chainId?: number): Promise<OverviewResult> {
  const qs = chainId !== undefined ? `?chainId=${chainId}` : "";
  return get<OverviewResult>(`/analytics/dashboard/overview${qs}`);
}

export function getTrading(chainId?: number): Promise<TradingResult> {
  const qs = chainId !== undefined ? `?chainId=${chainId}` : "";
  return get<TradingResult>(`/analytics/dashboard/trading${qs}`);
}

export function getUsers(chainId?: number): Promise<UsersResult> {
  const qs = chainId !== undefined ? `?chainId=${chainId}` : "";
  return get<UsersResult>(`/analytics/dashboard/users${qs}`);
}

export function getFunnel(chainId?: number): Promise<FunnelResult> {
  const qs = chainId !== undefined ? `?chainId=${chainId}` : "";
  return get<FunnelResult>(`/analytics/dashboard/funnel${qs}`);
}
