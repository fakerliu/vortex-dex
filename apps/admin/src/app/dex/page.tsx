"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPools, getProtocols, getRoutes } from "@/services/dex";

const LOGIN_KEY = "vortex_admin_authed";

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function formatImpact(raw: string): string {
  // avgPriceImpact 是 ×1e18 缩放
  try {
    const n = BigInt(raw);
    const whole = n / 1_000_000_000_000_000_000n;
    const frac = (n % 1_000_000_000_000_000_000n)
      .toString()
      .padStart(18, "0");
    return `${whole}.${frac.slice(0, 4)}%`;
  } catch {
    return "0%";
  }
}

export default function DexPage() {
  const [authed, setAuthed] = useState(false);
  const [chainId, setChainId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAuthed(window.localStorage.getItem(LOGIN_KEY) === "1");
    }
  }, []);

  const routes = useQuery({
    queryKey: ["dex-routes", chainId],
    queryFn: () => getRoutes(chainId),
    enabled: authed,
    retry: false,
  });
  const protocols = useQuery({
    queryKey: ["dex-protocols", chainId],
    queryFn: () => getProtocols(chainId),
    enabled: authed,
    retry: false,
  });
  const pools = useQuery({
    queryKey: ["dex-pools", chainId],
    queryFn: () => getPools(chainId),
    enabled: authed,
    retry: false,
  });

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-gray-500">请先完成管理员登录。</p>
          <a href="/" className="text-accent-400 hover:underline">
            返回登录页
          </a>
        </div>
      </div>
    );
  }

  const r = routes.data;
  const p = protocols.data;
  const pl = pools.data;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">VORTEX</span>
            <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400">
              DEX 专业分析
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
              返回仪表盘
            </a>
            <select
              value={chainId ?? ""}
              onChange={(e) =>
                setChainId(e.target.value ? Number(e.target.value) : undefined)
              }
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
            >
              <option value="">全部链</option>
              <option value="8453">Base Mainnet (8453)</option>
              <option value="84532">Base Sepolia (84532)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* 路由引擎分析 */}
        <h2 className="mb-4 text-xl font-semibold">路由引擎分析</h2>
        {routes.isLoading ? (
          <div className="text-gray-500">加载中...</div>
        ) : routes.isError ? (
          <div className="text-danger">
            加载失败：{(routes.error as Error)?.message}
          </div>
        ) : r ? (
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label="路由计算次数" value={String(r.totalRouteComputations)} />
            <KpiCard label="候选总数" value={String(r.totalCandidates)} />
            <KpiCard label="最佳路由命中率" value={`${r.selectionHitRate}%`} accent />
            <KpiCard label="平均候选数" value={r.avgCandidates} />
            <KpiCard label="平均计算耗时" value={`${r.avgComputeMs}ms`} />
            <KpiCard label="P95 耗时" value={`${r.p95ComputeMs}ms`} />
            <KpiCard label="路由优化收益路径" value={String(r.routeOptimizationGainPaths)} />
            <KpiCard label="候选数范围" value={`${r.minCandidates}~${r.maxCandidates}`} />
          </div>
        ) : null}

        {/* 协议分析 */}
        <h2 className="mb-4 text-xl font-semibold">协议分析</h2>
        {p?.protocols ? (
          <div className="mb-8 overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2">协议</th>
                  <th className="px-4 py-2">候选数</th>
                  <th className="px-4 py-2">被选中</th>
                  <th className="px-4 py-2">选中率</th>
                  <th className="px-4 py-2">平均价格影响</th>
                  <th className="px-4 py-2">平均净输出</th>
                </tr>
              </thead>
              <tbody>
                {p.protocols.map((proto) => (
                  <tr key={proto.protocol} className="border-t border-gray-200">
                    <td className="px-4 py-2 font-mono text-accent-400">
                      {proto.protocol}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{proto.totalCandidates}</td>
                    <td className="px-4 py-2 tabular-nums">{proto.selectedCount}</td>
                    <td className="px-4 py-2 tabular-nums">{proto.selectionRate}%</td>
                    <td className="px-4 py-2 tabular-nums">
                      {formatImpact(proto.avgPriceImpact)}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{proto.avgNetOutput}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* 池子分析 */}
        <h2 className="mb-4 text-xl font-semibold">池子分析（Top 20）</h2>
        {pl?.topPools ? (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">池子</th>
                  <th className="px-4 py-2">被路由次数</th>
                  <th className="px-4 py-2">被选中</th>
                  <th className="px-4 py-2">选中率</th>
                  <th className="px-4 py-2">流动性</th>
                </tr>
              </thead>
              <tbody>
                {pl.topPools.map((pool, i) => (
                  <tr key={pool.pool} className="border-t border-gray-200">
                    <td className="px-4 py-2 text-gray-500">{i + 1}.</td>
                    <td className="px-4 py-2 font-mono">{shortAddr(pool.pool)}</td>
                    <td className="px-4 py-2 tabular-nums">{pool.routedCount}</td>
                    <td className="px-4 py-2 tabular-nums">{pool.selectedCount}</td>
                    <td className="px-4 py-2 tabular-nums">{pool.selectionRate}%</td>
                    <td className="px-4 py-2 tabular-nums">
                      {pool.liquidity ? shortAddr(pool.liquidity) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 text-xs text-gray-500">{label}</div>
      <div
        className={`tabular-nums text-2xl font-semibold ${accent ? "text-accent-400" : "text-gray-900"}`}
      >
        {value}
      </div>
    </div>
  );
}
