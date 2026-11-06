"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getErrors, getHealth, getServices } from "@/services/monitor";

const LOGIN_KEY = "vortex_admin_authed";

export default function MonitorPage() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAuthed(window.localStorage.getItem(LOGIN_KEY) === "1");
    }
  }, []);

  const health = useQuery({
    queryKey: ["monitor-health"],
    queryFn: getHealth,
    enabled: authed,
    retry: false,
    refetchInterval: 15000,
  });
  const services = useQuery({
    queryKey: ["monitor-services"],
    queryFn: getServices,
    enabled: authed,
    retry: false,
  });
  const errors = useQuery({
    queryKey: ["monitor-errors"],
    queryFn: () => getErrors(),
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

  const h = health.data;
  const s = services.data;
  const e = errors.data;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">VORTEX</span>
            <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400">
              系统监控
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
              返回仪表盘
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* 健康状态 */}
        <h2 className="mb-4 text-xl font-semibold">健康状态</h2>
        {health.isLoading ? (
          <div className="text-gray-500">加载中...</div>
        ) : h ? (
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatusCard label="数据库" value={h.database === "up" ? "正常" : "异常"} ok={h.database === "up"} />
            <StatusCard label="Indexer" value={h.indexer.running ? "运行中" : "停止"} ok={h.indexer.running} />
            <StatusCard label="同步区块" value={h.indexer.lastSyncedBlock.toLocaleString()} ok={h.indexer.lastSyncedBlock > 0} />
            <StatusCard label="错误率(24h)" value={`${h.errorRate24h}%`} ok={Number(h.errorRate24h) < 1} />
            <StatusCard label="错误(24h)" value={String(h.errors24h.total)} ok={h.errors24h.total === 0} />
            <StatusCard label="技术错误" value={String(h.errors24h.technical)} ok={h.errors24h.technical === 0} />
            <StatusCard label="业务错误" value={String(h.errors24h.business)} ok={h.errors24h.business === 0} />
            <StatusCard label="指标样本(24h)" value={String(h.metrics24h)} ok />
          </div>
        ) : null}

        {/* 服务指标 */}
        <h2 className="mb-4 text-xl font-semibold">服务指标（最近 24h）</h2>
        {s?.services ? (
          <div className="mb-8 space-y-4">
            {s.services.map((svc) => (
              <div key={svc.service} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-2 font-mono text-accent-400">{svc.service}</div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {svc.metrics.map((m) => (
                    <div key={m.name} className="rounded-lg bg-white p-3">
                      <div className="text-xs text-gray-500">
                        {m.name}
                        {m.unit ? ` (${m.unit})` : ""}
                      </div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">
                        {m.avg}
                      </div>
                      <div className="text-xs text-gray-500">
                        max {m.max} · {m.samples} 样本
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !services.isLoading && (
            <div className="mb-8 text-gray-500">暂无服务指标（system_metrics 为空）。</div>
          )
        )}

        {/* 错误事件 */}
        <h2 className="mb-4 text-xl font-semibold">错误事件（最近 24h）</h2>
        {e?.topErrors && e.topErrors.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2">错误码</th>
                  <th className="px-4 py-2">类型</th>
                  <th className="px-4 py-2">次数</th>
                </tr>
              </thead>
              <tbody>
                {e.topErrors.map((err) => (
                  <tr key={err.errorCode} className="border-t border-gray-200">
                    <td className="px-4 py-2 font-mono">{err.errorCode}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          err.type === "technical"
                            ? "bg-danger/20 text-danger"
                            : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {err.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{err.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-500">暂无错误事件。</div>
        )}
      </main>
    </div>
  );
}

function StatusCard({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 text-xs text-gray-500">{label}</div>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-danger"}`}
        />
        <span className="tabular-nums text-xl font-semibold">{value}</span>
      </div>
    </div>
  );
}
