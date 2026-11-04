/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wagmi -> @wagmi/connectors 的 barrel 会 re-export baseAccount，
    // 从而把 @base-org/account -> @coinbase/cdp-sdk 整条依赖链带进来。
    // cdp-sdk 又静态/动态 import 了一堆可选的 x402 / solana peer deps
    // （@x402/*、@solana/kit、@solana-program/*），这些未安装时会导致
    // webpack 在编译期报 "Module not found"。本项目只使用 injected 连接器，
    // 从不触发 x402 支付 / Solana 签名路径，因此将这些包别名为空模块。
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402": false,
      "@solana": false,
      "@solana-program": false,
    };
    return config;
  },
};

export default nextConfig;
