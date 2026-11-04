"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { diagnoseIntent, getAiSummary } from "@/services/ai";

const LOGIN_KEY = "vortex_admin_authed";

export default function AiPage() {
  const [authed, setAuthed] = useState(false);
  const [intentId, setIntentId] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAuthed(window.localStorage.getItem(LOGIN_KEY) === "1");
    }
  }, []);

  const summary = useQuery({
    queryKey: ["ai-summary"],
    queryFn: getAiSummary,
    enabled: authed,
    retry: false,
  });
  const diagnose = useQuery({
    queryKey: ["ai-diagnose", intentId],
    queryFn: () => diagnoseIntent(intentId),
    enabled: authed && !!intentId,
    retry: false,
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

  const s = summary.data;
  const d = diagnose.data;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">VORTEX</span>
            <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-semibold text-accent-400">
              AI 分析
            </span>
          </div>
          <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-300">
            返回仪表盘
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* 智能摘要 */}
        <h2 className="mb-4 text-xl font-semibold">全局智能摘要</h2>
        {summary.isLoading ? (
          <div className="text-gray-500">生成中...</div>
        ) : summary.isError ? (
          <div className="text-danger">
            生成失败：{(summary.error as Error)?.message}
          </div>
        ) : s ? (
          <div className="mb-8 space-y-3">
            {s.report.map((p, i) => (
              <div key={i} className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm leading-relaxed">
                {p}
              </div>
            ))}
          </div>
        ) : null}

        {/* 单笔诊断 */}
        <h2 className="mb-4 text-xl font-semibold">单笔交易智能诊断</h2>
        <div className="mb-4 flex gap-3">
          <input
            value={intentId}
            onChange={(e) => setIntentId(e.target.value)}
            placeholder="输入 intent_id"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
          />
          <button
            onClick={() => intentId && diagnose.refetch()}
            disabled={!intentId || diagnose.isFetching}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-400 disabled:opacity-50"
          >
            {diagnose.isFetching ? "诊断中..." : "诊断"}
          </button>
        </div>
        {d && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            {Array.isArray(d.report) ? (
              <div className="space-y-2">
                {d.report.map((p, i) => (
                  <div key={i} className="text-sm leading-relaxed">
                    {p}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400">{d.report}</div>
            )}
            {d.diagnosis && (
              <div
                className={`mt-3 rounded-lg p-3 text-sm ${
                  d.diagnosis.level === "error"
                    ? "bg-danger/20 text-danger"
                    : d.diagnosis.level === "warning"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-green-500/20 text-green-400"
                }`}
              >
                结论：{d.diagnosis.summary}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
