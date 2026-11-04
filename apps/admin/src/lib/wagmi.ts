import { createConfig, createStorage, cookieStorage, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * admin 后台 wagmi 配置（管理员钱包签名验证用）。
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
