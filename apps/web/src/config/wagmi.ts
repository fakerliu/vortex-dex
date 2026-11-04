import { createConfig, createStorage, cookieStorage, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * wagmi 配置：真实钱包接入。
 * - 链：Base Mainnet + Base Sepolia
 * - 连接器：injected（MetaMask 等浏览器钱包）。
 *   注：coinbaseWallet 连接器会经 @wagmi/connectors -> @base-org/account ->
 *   @coinbase/cdp-sdk 引入破损的可选依赖 @x402/*，Phase 1 暂不启用，后续单独评估。
 * - RPC：环境变量可注入，默认公开 Base RPC
 * - ssr + cookieStorage：Next.js App Router 官方 SSR 安全模式
 */
export const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [injected()],
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
  transports: {
    [base.id]: http(
      process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org",
    ),
    [baseSepolia.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ??
        "https://sepolia.base.org",
    ),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
