"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getFunnel,
  getOverview,
  getTrading,
  getUsers,
} from "@/services/dashboard";
import { useAccount, useDisconnect } from "wagmi";

const LOGIN_KEY = "vortex_admin_authed";

function formatUsd(raw: string): string {
  // volumeUsd 是 USDC 6 decimals 原始整数
  try {
    const n = BigInt(raw);
    const whole = n / 1_000_000n;
    const frac = (n % 1_000_000n).toString().padStart(6, "0");
    return `$${whole.toLocaleString()}.${frac.slice(0, 2)}`;
  } catch {
    return "$0.00";
  }
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [authed, setAuthed] = useState(false);
  const [chainId, setChainId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAuthed(window.localStorage.getItem(LOGIN_KEY) === "1");
    }
  }, []);

  const overview = useQuery({
    queryKey: ["overview", chainId],
    queryFn: () => getOverview(chainId),
    enabled: authed,
    retry: false,
  });
  const funnel = useQuery({
    queryKey: ["funnel", chainId],
    queryFn: () => getFunnel(chainId),
    enabled: authed,
    retry: false,
  });
  const users = useQuery({
    queryKey: ["users", chainId],
    queryFn: () => getUsers(chainId),
    enabled: authed,
    retry: false,
  });
  const trading = useQuery({
    queryKey: ["trading", chainId],
    queryFn: () => getTrading(chainId),
    enabled: authed,
    retry: false,
  });

  function handleLogout() {
    window.localStorage.removeItem(LOGIN_KEY);
    setAuthed(false);
    disconnect();
  }

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

  const o = overview.data;
  const f = funnel.data;
  const u = users.data;
  const t = trading.data;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">VORTEX</span>
            <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400">
              Analytics Center
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dex" className="text-sm text-gray-500 hover:text-gray-700">
              DEX 专业分析
            </a>
            <a href="/monitor" className="text-sm text-gray-500 hover:text-gray-700">
              系统监控
            </a>
            <a href="/anomaly" className="text-sm text-gray-500 hover:text-gray-700">
              异常中心
            </a>
            <a href="/diagnosis" className="text-sm text-gray-500 hover:text-gray-700">
              问题诊断
            </a>
            <a href="/ai" className="text-sm text-gray-500 hover:text-gray-700">
              AI 分析
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
            {isConnected && (
              <span className="text-xs text-gray-500">{shortAddr(address!)}</span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Overview KPI 卡片 */}
        <h2 className="mb-4 text-xl font-semibold">经营总览</h2>
        {overview.isLoading ? (
          <div className="text-gray-500">加载中...</div>
        ) : overview.isError ? (
          <div className="text-danger">加载失败：{(overview.error as Error)?.message}</div>
        ) : o ? (
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label="累计交易量" value={formatUsd(o.volumeUsd)} />
            <KpiCard label="成交笔数" value={String(o.confirmedSwaps)} />
            <KpiCard label="活跃钱包(24h)" value={String(o.activeWallets24h)} />
            <KpiCard label="链上成功率" value={`${o.successRate}%`} />
            <KpiCard label="总交易数" value={String(o.totalSwaps)} />
            <KpiCard label="失败交易" value={String(o.failedSwaps)} />
            <KpiCard label="去重用户" value={String(o.uniqueUsers)} />
            <KpiCard label="状态" value="正常" accent />
          </div>
        ) : null}

        {/* 漏斗 */}
        <h2 className="mb-4 text-xl font-semibold">转化漏斗</h2>
        {funnel.isLoading ? (
          <div className="text-gray-500">加载中...</div>
        ) : f?.steps ? (
          <div className="mb-8 space-y-2">
            {f.steps.map((s) => {
              const max = Math.max(...f.steps.map((x) => x.count), 1);
              return (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="w-40 text-sm text-gray-500">{s.name}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                    <div
                      className="flex h-full items-center bg-accent-500 px-2 text-xs text-white"
                      style={{ width: `${(s.count / max) * 100}%` }}
                    >
                      {s.count}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* 用户 + 交易双栏 */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <h2 className="mb-4 text-xl font-semibold">活跃钱包 Top 20</h2>
            {u?.topWallets ? (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                {u.topWallets.map((w, i) => (
                  <div
                    key={w.wallet}
                    className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-sm last:border-0"
                  >
                    <span className="text-gray-500">
                      <span className="mr-2 text-gray-500">{i + 1}.</span>
                      {shortAddr(w.wallet)}
                    </span>
                    <span className="tabular-nums text-gray-500">{w.swaps} 笔</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <h2 className="mb-4 text-xl font-semibold">交易对 Top 20</h2>
            {t?.topPairs ? (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                {t.topPairs.map((p, i) => (
                  <div
                    key={`${p.tokenIn}-${p.tokenOut}`}
                    className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-sm last:border-0"
                  >
                    <span className="text-gray-500">
                      <span className="mr-2 text-gray-500">{i + 1}.</span>
                      {shortAddr(p.tokenIn)} → {shortAddr(p.tokenOut)}
                    </span>
                    <span className="tabular-nums text-gray-500">{p.swaps} 笔</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
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
