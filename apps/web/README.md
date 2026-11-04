# @vortex/web

VORTEX DEX 前端（Next.js App Router）。

## 技术栈
Next.js 15 + React 19 + TypeScript + Tailwind CSS v3 + wagmi v2 + viem v2 + TanStack Query v5。

## 已实现（Phase 1）
- Design Tokens（品牌色 / 中性色 / 字体 / 圆角，见 `tailwind.config.ts`）
- 基础组件 `src/components/ui/`：Button、Input、Card、Modal、Badge、Tooltip、Skeleton、EmptyState
- 全局布局：Header（72px，导航 + Network Selector + Wallet Connect）、Footer、1440px 容器
- 钱包接入：wagmi 真实连接（injected 连接器）、余额读取、Base Mainnet / Sepolia 网络切换
- Swap 页面：You Pay / You Receive、⇅ 交换、Token Selector（搜索/常用/余额/风险标记）、Quote Details、Route Details、主按钮状态机
- 报价服务占位：`src/services/quote.ts` 定义 Quote 类型契约与函数签名，未接后端（不发假数据）

## 运行
```bash
# 在 apps/web 目录（独立安装，npmmirror 加速）
pnpm install --ignore-workspace --registry=https://registry.npmmirror.com
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
```

## 说明
- Token 合约地址来自 Base 官方 token list / 公开可信列表（已核对），Logo 走 Trust Wallet assets，失败回退 Symbol 首字母。
- `next.config.mjs` 中对 `@x402` / `@solana` / `@solana-program` 做了 webpack alias，规避 wagmi → @coinbase/cdp-sdk 破损可选依赖导致的编译错误（本项目不触发 x402/Solana 路径）。
