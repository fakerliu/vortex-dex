# VORTEX DEX

[English](#english) · [中文](#chinese)

基于 **Base** 链的非托管 DEX Aggregator（去中心化交易所聚合器）。通过统一的 DEX 适配层接入 Aerodrome（classic + Slipstream CL）与 Uniswap V3，聚合多个流动性池的报价与路径，输出最优交易路径并生成可由前端钱包直接签名广播的 calldata。

A non-custodial DEX aggregator built on **Base**. It connects to Aerodrome (classic + Slipstream CL) and Uniswap V3 through a unified DEX adapter layer, aggregates quotes and paths across multiple liquidity pools, and produces optimal swap paths plus calldata that can be signed and broadcast directly by the user's wallet.

本仓库为 monorepo，**Sprint 0-9 已全部完成交付**：工程骨架、Token 模块、DEX 适配器、报价引擎、路由引擎、交易执行、链上事件索引、交易记录对账、经营分析均已实现，前后端已打通真实报价与交易全链路。

This is a monorepo with **Sprint 0-9 fully delivered**: project scaffold, Token module, DEX adapters, quote engine, route engine, swap execution, on-chain event indexing, transaction reconciliation, and business analytics are all implemented, with the frontend and backend connected end-to-end for real quotes and swaps.

---

<a name="chinese"></a>
# 中文

## 核心特性

- **非托管交易**：后端只产出 calldata 供前端钱包签名广播，绝不接触私钥/助记词/已签名交易，仅接收公开的 `tx_hash`。
- **多协议适配**：统一 `DexAdapter` 接口，实现 Aerodrome Classic（Velodrome v2 fork）、Aerodrome Slipstream CL（Uniswap v3 fork）、Uniswap V3 三类适配器。
- **报价引擎**：多池聚合选最优，区分 V2 恒定乘积 / stable 不变式 / V3 集中流动性三类定价逻辑。
- **路由引擎**：多跳路径搜索（BFS + hub 代币集），按 `NetOutput = amountOut - gasCost` 排序。
- **链上事件索引**：区块扫描 + 断点续传 + 重组检测 + 幂等写入，只索引 Base Mainnet 的 Aerodrome 池子。
- **交易记录与对账**：`backfill` 从链上事件回填交易，`reconcile` 核验 PENDING 状态，用户维度聚合平台与链上两类来源。
- **经营分析**：量（volume）与收入（revenue）严格分离，无 USD 预言机时不伪造 USD，指标带来源可追踪。

## 界面预览

### 前端（apps/web）

| Swap 交易 | Explore 币种榜单 |
| --- | --- |
| ![Swap 交易](docs/screenshots/swap.png) | ![Explore 币种榜单](docs/screenshots/explore.png) |

### 后台管理（apps/admin）

| 经营分析 | MEV 数据看板 | 系统监控 |
| --- | --- | --- |
| ![经营分析](docs/screenshots/admin-analytics.png) | ![MEV 数据看板](docs/screenshots/admin-mev.png) | ![系统监控](docs/screenshots/admin-monitor.png) |

## 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 前端 | Next.js 15 + React 19 + TypeScript + Tailwind CSS v3 | `apps/web` |
| 前端状态/钱包 | wagmi v2 + viem v2 + TanStack Query v5 | 钱包连接、链上读取、签名广播 |
| 后端 | NestJS 10 | `apps/api` |
| ORM/数据库 | Prisma 5.22 + PostgreSQL 16 | `apps/api/prisma` |
| 链上交互 | viem v2 | RPC 读取、事件解析、calldata 编码 |
| 共享包 | TypeScript | `packages/shared`、`packages/config`、`packages/sdk` |
| 合约 | Solidity + Foundry（占位，尚未编写 .sol） | `contracts` |
| 基础设施 | PostgreSQL 16 + Redis 7 | 根目录 `docker-compose.yml` |
| 包管理 | pnpm workspace | 根目录 `pnpm-workspace.yaml` |

## 目录结构

```
vortex-dex/
├── apps/
│   ├── web/                  # Next.js 前端
│   │   └── src/
│   │       ├── app/          # App Router 页面（/ 重定向 /swap；/swap、/transactions、/analytics）
│   │       ├── components/   # UI 基础组件、layout、navigation、wallet、token、swap
│   │       ├── config/       # wagmi、chains、tokens 配置
│   │       ├── hooks/        # useQuote、useSwapExecution、useTokenBalance
│   │       ├── services/     # quote.ts、swap.ts（后端 API 封装）
│   │       ├── types/        # quote、swap、token 类型契约
│   │       └── utils/        # cn、format（BigInt 金额格式化）
│   └── api/                  # NestJS 后端
│       ├── prisma/           # schema.prisma、migrations/、seed.ts
│       ├── scripts/          # smoke.ts、verify-aerodrome.ts
│       └── src/
│           ├── chain/        # RPC 客户端、ERC-20 读取、token 目录、地址工具
│           ├── common/       # 全局异常过滤器、响应拦截器、错误码、单位工具
│           ├── dex/          # DEX 适配层（aerodrome、uniswap-v3、math、calldata）
│           ├── indexer/      # 链上事件索引器（扫描/断点续传/重组检测）
│           ├── modules/      # health、token、quote、route、swap、user、analytics、protocol、pool
│           └── prisma/       # PrismaService
├── packages/
│   ├── shared/               # 链常量、地址校验与规范化
│   ├── config/               # 环境变量读取工具
│   └── sdk/                  # SDK（占位，仅 SDK_VERSION）
├── contracts/                # Foundry 合约项目（占位，src/script/test 仅 .gitkeep）
├── infrastructure/
│   ├── docker/               # 生产/预发 Docker 配置（占位）
│   └── scripts/              # 运维脚本（占位）
├── docs/                     # 项目文档
├── tests/                    # 集成 / E2E 测试（占位）
├── docker-compose.yml        # 本地基础设施（PostgreSQL + Redis）
├── .env.example
├── package.json              # pnpm workspace 根
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 前置条件

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | >= 20 | 已实测 v22.22.2 |
| pnpm | >= 9 | 已实测 9.15.0 |
| Git | 2.x | 已实测 2.55.0 |
| Docker | 可选 | 本地基础设施（PostgreSQL/Redis）需要；未安装时可自建数据库 |
| Foundry (forge) | 可选 | 仅合约开发需要；当前 contracts 尚未编写 .sol |

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 按需编辑 .env（RPC、数据库、Redis、链 ID 等）
```

### 3. 启动本地基础设施（PostgreSQL + Redis）

```bash
docker compose up -d
```

无 Docker 时可自行安装 PostgreSQL 16 / Redis 7，并修改 `.env` 中的连接信息。

### 4. 初始化数据库（迁移 + 种子数据）

```bash
pnpm --filter @vortex/api prisma:migrate   # 应用迁移
pnpm --filter @vortex/api seed             # 写入 Base Mainnet/Sepolia 精选 Token
```

### 5. 启动后端 / 前端

```bash
# 后端（http://localhost:3001/api/v1）
pnpm dev:api

# 前端（http://localhost:3000，根路径重定向到 /swap）
pnpm dev:web
```

前端需配置 `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1` 才能接后端真实报价。

### 6. 合约（可选）

`contracts/` 目前为 Foundry 占位（无 .sol 源码），尚未编写合约。需先安装 Foundry：

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## 已实现功能清单（按 Sprint）

| Sprint | 交付内容 |
| --- | --- |
| Sprint 0 | monorepo 工程骨架、pnpm workspace、docker-compose、共享包（shared/config/sdk） |
| Sprint 1 | Prisma schema（11 张表）、NestJS 骨架（/api/v1 前缀、统一响应/错误结构）、health |
| Sprint 2 | chain 层（RPC 客户端 + ERC-20 读取）、Token 模块 5 个 API |
| Sprint 3 | DEX Adapter 层（Aerodrome Classic + Slipstream CL，地址链上核验） |
| Sprint 4 | 报价引擎（`POST /quote`，多池聚合选最优） |
| Sprint 5 | 路由引擎（`POST /route`，多跳路径 + NetOutput 排序） |
| Sprint 6 | 交易执行（`POST /swaps/prepare`、`POST /swaps/submit`，11 态状态机，非托管） |
| Sprint 7 | Indexer（区块扫描、断点续传、重组检测、幂等写入） |
| Sprint 8 | 交易记录（backfill / reconcile 对账）、User 模块 |
| Sprint 9 | 经营分析（summary / daily / protocol-distribution / aggregate） |
| 收尾 | 前后端对接真实报价、Review Swap 签名广播全链路、Uniswap V3 Sepolia 适配器（84532 测试网） |

### 当前尚未实现 / 占位

- `contracts/`：Foundry 项目仅骨架，尚未编写任何 `.sol` 合约。
- `packages/sdk`：仅 `SDK_VERSION` 占位，报价/路由/交易执行能力在后端实现，未下沉到 SDK。
- `infrastructure/docker`、`infrastructure/scripts`、`tests/`：目录占位，未实现。
- `GET /api/v1/protocols`、`GET /api/v1/pools`：仅路由占位，返回 `{ implemented: false }`。
- 前端 `/analytics` 入口已隐藏（后端/内部功能不对外暴露），路由本身保留。
- 经营分析暂无 USD 价格预言机：volume 只给原始 token 量 + 笔数，`revenue.available = false`，不伪造 USD。

## 共享包说明

- `@vortex/shared`：链常量（Base 主网 8453 / Base Sepolia 84532）、`isAddress` / `normalizeAddress` / `shortenAddress` 地址工具。
- `@vortex/config`：`getEnv` / `getEnvNumber` / `getEnvBoolean` / `getEnvironment` 等环境变量读取工具。
- `@vortex/sdk`：占位，仅导出 `SDK_VERSION = '0.1.0'`。

## 环境变量

完整清单见 `.env.example`，关键项：

| 变量 | 说明 | 缺省 |
| --- | --- | --- |
| `APP_ENV` | 运行环境（local / testnet / mainnet） | `local` |
| `PORT` / `API_PORT` | 前端 / 后端端口 | `3000` / `3001` |
| `BASE_MAINNET_RPC_URL` | Base 主网 RPC | `https://mainnet.base.org` |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC | `https://sepolia.base.org` |
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://vortex:vortex@localhost:5432/vortex?schema=public` |
| `REDIS_URL` | Redis 连接串 | `redis://localhost:6379` |
| `NEXT_PUBLIC_API_BASE_URL` | 前端访问后端的基础 URL | 无（未配置时前端显示「待接入」） |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect 项目 ID（敏感） | 空 |

## 常用脚本

```bash
pnpm -r list          # 查看 workspace 识别到的包
pnpm build            # 构建所有包
pnpm typecheck        # 类型检查
pnpm lint             # ESLint
pnpm format           # Prettier 格式化
pnpm format:check     # Prettier 格式检查
pnpm dev:web          # 启动前端
pnpm dev:api          # 启动后端
```

## 文档

- [架构设计](docs/architecture.md)
- [API 文档](docs/api.md)
- [部署手册](docs/deployment.md)
- [数据真实性设计](docs/data-authenticity.md)
- [指标字典](docs/metrics-dictionary.md)

## 安全规范

- 私钥（`DEPLOYER_PRIVATE_KEY`）、API Key（`ETHERSCAN_API_KEY`、WalletConnect）等敏感信息
  **一律经环境变量 / 密钥管理注入，禁止明文提交**。
- `.env` 已被 `.gitignore` 忽略；`.env.example` 只含占位符，不含真实值。
- 合约地址以部署广播产物与区块浏览器为准，**不要在仓库硬编码或编造地址**。
- 后端「非托管铁律」：绝不接收私钥/助记词/已签名交易，只接收公开 `tx_hash`。
- 金额「精度铁律」：链上原始大整数一律字符串，比率一律十进制字符串，禁止 Float。

## 约定

- 提交前执行 `pnpm lint`、`pnpm format:check`、`pnpm typecheck`。
- 包名统一 `@vortex/*` 命名空间。

---

<a name="english"></a>
# English

## Core Features

- **Non-custodial swaps**: the backend only produces calldata for the frontend wallet to sign and broadcast. It never touches private keys, mnemonics, or signed transactions — it only receives the public `tx_hash`.
- **Multi-protocol adapters**: a unified `DexAdapter` interface with three implementations — Aerodrome Classic (Velodrome v2 fork), Aerodrome Slipstream CL (Uniswap v3 fork), and Uniswap V3.
- **Quote engine**: aggregates multiple pools and picks the best quote, distinguishing three pricing models — V2 constant product, stable invariant, and V3 concentrated liquidity.
- **Route engine**: multi-hop path search (BFS + hub token set), ranked by `NetOutput = amountOut - gasCost`.
- **On-chain event indexing**: block scanning + checkpoint resume + reorg detection + idempotent writes, indexing Aerodrome pools on Base Mainnet only.
- **Transaction records & reconciliation**: `backfill` reconstructs transactions from on-chain events, `reconcile` verifies PENDING state, aggregating platform and on-chain sources per user.
- **Business analytics**: volume and revenue are strictly separated. When no USD oracle is available, USD values are never fabricated; every metric carries a traceable source.

## Screenshots

### Frontend (apps/web)

| Swap | Explore |
| --- | --- |
| ![Swap](docs/screenshots/swap.png) | ![Explore](docs/screenshots/explore.png) |

### Admin (apps/admin)

| Analytics | MEV Dashboard | System Monitor |
| --- | --- | --- |
| ![Analytics](docs/screenshots/admin-analytics.png) | ![MEV Dashboard](docs/screenshots/admin-mev.png) | ![System Monitor](docs/screenshots/admin-monitor.png) |

## Tech Stack

| Layer | Tech | Notes |
| --- | --- | --- |
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind CSS v3 | `apps/web` |
| Frontend state/wallet | wagmi v2 + viem v2 + TanStack Query v5 | Wallet connection, on-chain reads, signature broadcast |
| Backend | NestJS 10 | `apps/api` |
| ORM/DB | Prisma 5.22 + PostgreSQL 16 | `apps/api/prisma` |
| On-chain | viem v2 | RPC reads, event parsing, calldata encoding |
| Shared packages | TypeScript | `packages/shared`, `packages/config`, `packages/sdk` |
| Contracts | Solidity + Foundry (placeholder, no .sol yet) | `contracts` |
| Infrastructure | PostgreSQL 16 + Redis 7 | root `docker-compose.yml` |
| Package manager | pnpm workspace | root `pnpm-workspace.yaml` |

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | >= 20 | Tested with v22.22.2 |
| pnpm | >= 9 | Tested with 9.15.0 |
| Git | 2.x | Tested with 2.55.0 |
| Docker | Optional | Needed for local infra (PostgreSQL/Redis); you may self-host these instead |
| Foundry (forge) | Optional | Only for contract development; `contracts` has no `.sol` yet |

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env as needed (RPC, database, Redis, chain ID, etc.)
```

### 3. Start local infrastructure (PostgreSQL + Redis)

```bash
docker compose up -d
```

Without Docker, install PostgreSQL 16 / Redis 7 yourself and update the connection info in `.env`.

### 4. Initialize the database (migrate + seed)

```bash
pnpm --filter @vortex/api prisma:migrate   # apply migrations
pnpm --filter @vortex/api seed             # seed curated Base Mainnet/Sepolia tokens
```

### 5. Start backend / frontend

```bash
# Backend (http://localhost:3001/api/v1)
pnpm dev:api

# Frontend (http://localhost:3000, root redirects to /swap)
pnpm dev:web
```

Set `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1` in the frontend to connect to the backend for real quotes.

### 6. Contracts (optional)

`contracts/` is currently a Foundry placeholder (no `.sol` sources). Install Foundry first if you want to develop contracts:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Implemented Features (by Sprint)

| Sprint | Deliverables |
| --- | --- |
| Sprint 0 | Monorepo scaffold, pnpm workspace, docker-compose, shared packages (shared/config/sdk) |
| Sprint 1 | Prisma schema (11 tables), NestJS skeleton (/api/v1 prefix, unified response/error structure), health |
| Sprint 2 | chain layer (RPC client + ERC-20 reads), Token module with 5 APIs |
| Sprint 3 | DEX Adapter layer (Aerodrome Classic + Slipstream CL, on-chain address verification) |
| Sprint 4 | Quote engine (`POST /quote`, multi-pool best-quote selection) |
| Sprint 5 | Route engine (`POST /route`, multi-hop paths + NetOutput ranking) |
| Sprint 6 | Swap execution (`POST /swaps/prepare`, `POST /swaps/submit`, 11-state machine, non-custodial) |
| Sprint 7 | Indexer (block scanning, checkpoint resume, reorg detection, idempotent writes) |
| Sprint 8 | Transaction records (backfill / reconcile), User module |
| Sprint 9 | Business analytics (summary / daily / protocol-distribution / aggregate) |
| Finalize | End-to-end real quotes, review-swap signature broadcast, Uniswap V3 Sepolia adapter (84532 testnet) |

### Not yet implemented / placeholders

- `contracts/`: Foundry scaffold only, no `.sol` contracts written yet.
- `packages/sdk`: only a `SDK_VERSION` placeholder; quote/route/swap capabilities live in the backend, not yet moved to the SDK.
- `infrastructure/docker`, `infrastructure/scripts`, `tests/`: directory placeholders, not implemented.
- `GET /api/v1/protocols`, `GET /api/v1/pools`: route placeholders returning `{ implemented: false }`.
- The frontend `/analytics` entry is hidden (internal/backend functionality not exposed to users); the route itself is kept.
- Business analytics has no USD price oracle yet: volume returns raw token amounts + counts, `revenue.available = false`, and USD is never fabricated.

## Shared Packages

- `@vortex/shared`: chain constants (Base mainnet 8453 / Base Sepolia 84532), `isAddress` / `normalizeAddress` / `shortenAddress` address utilities.
- `@vortex/config`: `getEnv` / `getEnvNumber` / `getEnvBoolean` / `getEnvironment` environment-variable helpers.
- `@vortex/sdk`: placeholder, only exports `SDK_VERSION = '0.1.0'`.

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description | Default |
| --- | --- | --- |
| `APP_ENV` | Runtime environment (local / testnet / mainnet) | `local` |
| `PORT` / `API_PORT` | Frontend / backend ports | `3000` / `3001` |
| `BASE_MAINNET_RPC_URL` | Base mainnet RPC | `https://mainnet.base.org` |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC | `https://sepolia.base.org` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://vortex:vortex@localhost:5432/vortex?schema=public` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `NEXT_PUBLIC_API_BASE_URL` | Base URL for the frontend to reach the backend | none (frontend shows "not connected" when unset) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID (sensitive) | empty |

## Common Scripts

```bash
pnpm -r list          # list packages recognized by the workspace
pnpm build            # build all packages
pnpm typecheck        # type check
pnpm lint             # ESLint
pnpm format           # Prettier format
pnpm format:check     # Prettier format check
pnpm dev:web          # start frontend
pnpm dev:api          # start backend
```

## Documentation

- [Architecture](docs/architecture.md)
- [API Reference](docs/api.md)
- [Deployment Guide](docs/deployment.md)
- [Data Authenticity Design](docs/data-authenticity.md)
- [Metrics Dictionary](docs/metrics-dictionary.md)

## Security

- Sensitive data such as private keys (`DEPLOYER_PRIVATE_KEY`) and API keys (`ETHERSCAN_API_KEY`, WalletConnect)
  **must be injected via environment variables / secret management, never committed in plaintext**.
- `.env` is git-ignored; `.env.example` contains only placeholders, no real values.
- Contract addresses must be taken from deployment broadcast artifacts and block explorers — **never hardcode or invent addresses in the repo**.
- Backend "non-custodial rule": never accept private keys, mnemonics, or signed transactions — only the public `tx_hash`.
- Amount "precision rule": on-chain raw integers are always strings, ratios are always decimal strings, and Float is forbidden.

## Conventions

- Run `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` before committing.
- All package names use the `@vortex/*` namespace.
