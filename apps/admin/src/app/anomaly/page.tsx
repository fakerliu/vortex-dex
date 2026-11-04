"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getEvents,
  getRules,
  resolveEvent,
  scan,
  seedRules,
  toggleRule,
} from "@/services/anomaly";

const LOGIN_KEY = "vortex_admin_authed";

export default function AnomalyPage() {
  const [authed, setAuthed] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAuthed(window.localStorage.getItem(LOGIN_KEY) === "1");
    }
  }, []);

  const rules = useQuery({
    queryKey: ["anomaly-rules"],
    queryFn: getRules,
    enabled: authed,
    retry: false,
  });
  const events = useQuery({
    queryKey: ["anomaly-events"],
    queryFn: () => getEvents(),
    enabled: authed,
    retry: false,
  });

  const scanMut = useMutation({
    mutationFn: scan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anomaly-events"] }),
  });
  const seedMut = useMutation({
    mutationFn: seedRules,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anomaly-rules"] }),
  });
  const resolveMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "acknowledged" | "resolved" }) =>
      resolveEvent(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anomaly-events"] }),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      toggleRule(id, isEnabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["anomaly-rules"] }),
  });

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-gray-400">请先完成管理员登录。</p>
          <a href="/" className="text-accent-400 hover:underline">
            返回登录页
          </a>
        </div>
      </div>
    );
  }

  const r = rules.data;
  const e = events.data;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">VORTEX</span>
            <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400">
              异常中心
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-300">
              返回仪表盘
            </a>
            <button
              onClick={() => seedMut.mutate()}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm hover:border-gray-600"
            >
              初始化规则
            </button>
            <button
              onClick={() => scanMut.mutate()}
              disabled={scanMut.isPending}
              className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-400 disabled:opacity-50"
            >
              {scanMut.isPending ? "扫描中..." : "立即扫描"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* 扫描结果 */}
        {scanMut.data && (
          <div className="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="text-sm">
              扫描 {scanMut.data.scannedRules} 条规则，触发{" "}
              <span className="text-accent-400">{scanMut.data.triggered}</span> 条异常
            </div>
            {scanMut.data.anomalies.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-gray-400">
                {scanMut.data.anomalies.map((a, i) => (
                  <li key={i}>
                    [{a.severity}] {a.ruleName}：{a.metricValue}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 告警规则 */}
        <h2 className="mb-4 text-xl font-semibold">告警规则</h2>
        {r?.rules ? (
          <div className="mb-8 overflow-hidden rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-gray-400">
                <tr>
                  <th className="px-4 py-2">规则名</th>
                  <th className="px-4 py-2">指标</th>
                  <th className="px-4 py-2">条件</th>
                  <th className="px-4 py-2">阈值</th>
                  <th className="px-4 py-2">级别</th>
                  <th className="px-4 py-2">状态</th>
                  <th className="px-4 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {r.rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-gray-800">
                    <td className="px-4 py-2">{rule.name}</td>
                    <td className="px-4 py-2 font-mono">{rule.metric_name}</td>
                    <td className="px-4 py-2 font-mono">{rule.operator}</td>
                    <td className="px-4 py-2 tabular-nums">{rule.threshold}</td>
                    <td className="px-4 py-2">
                      <SeverityBadge severity={rule.severity} />
                    </td>
                    <td className="px-4 py-2">
                      <span className={rule.is_enabled ? "text-green-400" : "text-gray-500"}>
                        {rule.is_enabled ? "启用" : "停用"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() =>
                          toggleMut.mutate({ id: rule.id, isEnabled: !rule.is_enabled })
                        }
                        className="text-xs text-accent-400 hover:underline"
                      >
                        {rule.is_enabled ? "停用" : "启用"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !rules.isLoading && (
            <div className="mb-8 text-gray-500">
              暂无规则，点击「初始化规则」创建内置规则。
            </div>
          )
        )}

        {/* 异常事件 */}
        <h2 className="mb-4 text-xl font-semibold">
          异常事件
          {e ? <span className="ml-2 text-sm text-gray-500">未处理 {e.openCount}</span> : null}
        </h2>
        {e?.events && e.events.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-gray-400">
                <tr>
                  <th className="px-4 py-2">级别</th>
                  <th className="px-4 py-2">规则</th>
                  <th className="px-4 py-2">指标值</th>
                  <th className="px-4 py-2">阈值</th>
                  <th className="px-4 py-2">状态</th>
                  <th className="px-4 py-2">时间</th>
                  <th className="px-4 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {e.events.map((ev) => (
                  <tr key={ev.id} className="border-t border-gray-800">
                    <td className="px-4 py-2">
                      <SeverityBadge severity={ev.severity} />
                    </td>
                    <td className="px-4 py-2">{ev.rule_name}</td>
                    <td className="px-4 py-2 tabular-nums">{ev.metric_value}</td>
                    <td className="px-4 py-2 tabular-nums">{ev.threshold}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          ev.status === "open"
                            ? "text-accent-400"
                            : ev.status === "acknowledged"
                              ? "text-amber-400"
                              : "text-gray-500"
                        }
                      >
                        {ev.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      {ev.status === "open" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              resolveMut.mutate({ id: ev.id, status: "acknowledged" })
                            }
                            className="text-xs text-amber-400 hover:underline"
                          >
                            确认
                          </button>
                          <button
                            onClick={() =>
                              resolveMut.mutate({ id: ev.id, status: "resolved" })
                            }
                            className="text-xs text-green-400 hover:underline"
                          >
                            解决
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !events.isLoading && <div className="text-gray-500">暂无异常事件。</div>
        )}
      </main>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "critical"
      ? "bg-danger/20 text-danger"
      : severity === "warning"
        ? "bg-amber-500/20 text-amber-400"
        : "bg-blue-500/20 text-blue-400";
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{severity}</span>;
}
