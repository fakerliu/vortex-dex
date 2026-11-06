"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFailures, getIntents, traceIntent } from "@/services/diagnosis";

const LOGIN_KEY = "vortex_admin_authed";

function shortAddr(a: string): string {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
}

export default function DiagnosisPage() {
  const [authed, setAuthed] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAuthed(window.localStorage.getItem(LOGIN_KEY) === "1");
    }
  }, []);

  const intents = useQuery({
    queryKey: ["diagnosis-intents"],
    queryFn: () => getIntents(),
    enabled: authed,
    retry: false,
  });
  const failures = useQuery({
    queryKey: ["diagnosis-failures"],
    queryFn: getFailures,
    enabled: authed,
    retry: false,
  });
  const trace = useQuery({
    queryKey: ["diagnosis-trace", selectedIntent],
    queryFn: () => traceIntent(selectedIntent!),
    enabled: authed && !!selectedIntent,
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

  const t = trace.data;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">VORTEX</span>
            <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400">
              问题诊断
            </span>
          </div>
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            返回仪表盘
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* 交易意图列表 */}
        <h2 className="mb-4 text-xl font-semibold">交易意图（intent_id）</h2>
        {intents.data?.intents && intents.data.intents.length > 0 ? (
          <div className="mb-8 overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2">intent_id</th>
                  <th className="px-4 py-2">钱包</th>
                  <th className="px-4 py-2">交易对</th>
                  <th className="px-4 py-2">状态</th>
                  <th className="px-4 py-2">时间</th>
                  <th className="px-4 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {intents.data.intents.map((it) => (
                  <tr key={it.intent_id} className="border-t border-gray-200">
                    <td className="px-4 py-2 font-mono text-xs">{shortAddr(it.intent_id)}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {shortAddr(it.wallet_address ?? "")}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {shortAddr(it.token_in ?? "")} → {shortAddr(it.token_out ?? "")}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={it.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(it.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setSelectedIntent(it.intent_id)}
                        className="text-xs text-accent-400 hover:underline"
                      >
                        追踪
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mb-8 text-gray-500">
            暂无交易意图（intent_id 埋点链路待真实交易产生数据）。
          </div>
        )}

        {/* 失败交易 */}
        <h2 className="mb-4 text-xl font-semibold">失败交易</h2>
        {failures.data?.failures && failures.data.failures.length > 0 ? (
          <div className="mb-8 overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2">txHash</th>
                  <th className="px-4 py-2">交易对</th>
                  <th className="px-4 py-2">失败原因</th>
                  <th className="px-4 py-2">时间</th>
                </tr>
              </thead>
              <tbody>
                {failures.data.failures.map((f) => (
                  <tr key={f.swapId} className="border-t border-gray-200">
                    <td className="px-4 py-2 font-mono text-xs">{shortAddr(f.txHash)}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {shortAddr(f.tokenIn)} → {shortAddr(f.tokenOut)}
                    </td>
                    <td className="px-4 py-2 text-xs text-danger">
                      {f.failureReason ?? f.status}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(f.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mb-8 text-gray-500">暂无失败交易。</div>
        )}

        {/* 追踪详情 */}
        {selectedIntent && (
          <div className="rounded-xl border border-gray-200 p-4">
            <h2 className="mb-4 text-xl font-semibold">链路追踪详情</h2>
            {trace.isLoading ? (
              <div className="text-gray-500">加载中...</div>
            ) : !t?.found ? (
              <div className="text-gray-500">未找到该意图（intent_id 不存在）。</div>
            ) : (
              <div className="space-y-4">
                {t.diagnosis && (
                  <div
                    className={`rounded-lg p-3 text-sm ${
                      t.diagnosis.level === "error"
                        ? "bg-danger/20 text-danger"
                        : t.diagnosis.level === "warning"
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-green-500/20 text-green-400"
                    }`}
                  >
                    <div className="font-semibold">诊断结论</div>
                    <div>{t.diagnosis.summary}</div>
                  </div>
                )}
                {t.funnelProgress && (
                  <div className="text-sm text-gray-500">
                    漏斗进度：第 {t.funnelProgress.reachedStep}/{t.funnelProgress.totalSteps} 步
                    （{t.funnelProgress.reachedStepName}）
                  </div>
                )}
                {t.steps && t.steps.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {t.steps.map((s) => (
                      <span
                        key={s.name}
                        className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500"
                      >
                        {s.step}. {s.name}
                      </span>
                    ))}
                  </div>
                )}
                {t.errors && t.errors.length > 0 && (
                  <div>
                    <div className="mb-1 text-sm text-gray-500">错误事件</div>
                    {t.errors.map((e, i) => (
                      <div key={i} className="text-xs text-gray-500">
                        [{e.errorType}] {e.errorCode}：{e.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "confirmed"
      ? "bg-green-500/20 text-green-400"
      : status === "failed"
        ? "bg-danger/20 text-danger"
        : "bg-gray-200 text-gray-500";
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{status}</span>;
}
