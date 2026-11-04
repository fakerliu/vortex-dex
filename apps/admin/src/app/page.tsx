"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * 管理员登录页。
 *
 * 内部后台访问控制（第一阶段）：
 * - 连接钱包
 * - 钱包地址须在 NEXT_PUBLIC_ADMIN_WALLETS 白名单内（逗号分隔，小写）
 * - 签名一条固定消息（证明私钥持有），验签通过后进入
 * - 登录态存 localStorage（会话级）
 *
 * 后续步骤会升级为后端 AdminGuard（钱包签名 + 白名单，服务端校验）。
 */

const ADMIN_WALLETS = (process.env.NEXT_PUBLIC_ADMIN_WALLETS ?? "")
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

const LOGIN_KEY = "vortex_admin_authed";

function isAdmin(address: string | undefined): boolean {
  if (!address) return false;
  if (ADMIN_WALLETS.length === 0) return true; // 未配置白名单时开发模式放行
  return ADMIN_WALLETS.includes(address.toLowerCase());
}

export default function LoginPage() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [authed, setAuthed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAuthed(window.localStorage.getItem(LOGIN_KEY) === "1");
    }
  }, []);

  const admin = isAdmin(address);

  async function handleLogin() {
    setError(null);
    if (!address) return;
    if (!admin) {
      setError("当前钱包不在管理员白名单内。");
      return;
    }
    try {
      setSigning(true);
      // 签名固定消息证明私钥持有（签名结果仅本地验证，不上链）
      await signMessageAsync({
        message: `VORTEX DEX Admin Login\naddress: ${address.toLowerCase()}\ntimestamp: ${Date.now()}`,
      });
      window.localStorage.setItem(LOGIN_KEY, "1");
      setAuthed(true);
    } catch {
      setError("签名被拒绝，无法完成管理员验证。");
    } finally {
      setSigning(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(LOGIN_KEY);
    setAuthed(false);
    disconnect();
  }

  if (authed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
          <div className="mb-4 text-2xl font-bold">VORTEX Analytics Center</div>
          <p className="mb-6 text-sm text-gray-400">
            已通过管理员验证。
            <br />
            仪表盘在下方页面（/dashboard）。
          </p>
          <a
            href="/dashboard"
            className="inline-block rounded-lg bg-accent-500 px-6 py-2 font-semibold text-white hover:bg-accent-400"
          >
            进入仪表盘
          </a>
          <button
            onClick={handleLogout}
            className="mt-4 block w-full text-sm text-gray-500 hover:text-gray-300"
          >
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        <h1 className="mb-2 text-2xl font-bold">VORTEX Analytics Center</h1>
        <p className="mb-6 text-sm text-gray-400">
          内部运营后台 — 仅限管理员访问。
        </p>

        {!isConnected ? (
          <button
            onClick={() => connect({ connector: injected() })}
            className="w-full rounded-lg bg-accent-500 px-6 py-3 font-semibold text-white hover:bg-accent-400"
          >
            连接钱包
          </button>
        ) : (
          <div>
            <div className="mb-4 break-all rounded-lg bg-gray-800 p-3 text-xs text-gray-300">
              已连接：{address}
              {!admin && (
                <div className="mt-2 text-danger">⚠ 不在管理员白名单内</div>
              )}
            </div>
            <button
              onClick={handleLogin}
              disabled={signing || !admin}
              className="w-full rounded-lg bg-accent-500 px-6 py-3 font-semibold text-white hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signing ? "签名中..." : "签名验证登录"}
            </button>
            <button
              onClick={() => disconnect()}
              className="mt-3 w-full text-sm text-gray-500 hover:text-gray-300"
            >
              断开钱包
            </button>
          </div>
        )}

        {error && <div className="mt-4 text-sm text-danger">{error}</div>}
      </div>
    </div>
  );
}
