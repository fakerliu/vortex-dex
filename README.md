# VORTEX DEX

基于 **Base** 链的去中心化交易所（DEX）。本仓库为 monorepo 工程骨架（Sprint 0），
当前只包含工程结构与占位包，**尚未包含任何业务逻辑**。

## 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 前端 | Next.js（React） | `apps/web` |
| 后端 | NestJS | `apps/api` |
| 共享包 | TypeScript | `packages/shared`、`packages/config`、`packages/sdk` |
| 合约 | Solidity + Foundry | `contracts` |
| 基础设施 | PostgreSQL + Redis | 根目录 `docker-compose.yml` |
| 包管理 | pnpm workspace | 根目录 `pnpm-workspace.yaml` |

## 目录结构

```
vortex-dex/
├── apps/
│   ├── web/          # Next.js 前端（占位，frontend-engineer 负责）
│   └── api/          # NestJS 后端（占位）
├── packages/
│   ├── shared/       # 共享类型/常量（链配置、地址工具）
│   ├── config/       # 共享配置（环境变量读取）
│   └── sdk/          # SDK 占位
├── contracts/        # Foundry 合约项目占位
├── infrastructure/
│   ├── docker/       # 部署向 Docker 配置
│   └── scripts/      # 运维脚本
├── docs/             # 项目文档
├── tests/            # 集成 / E2E 测试
├── docker-compose.yml
├── .env.example
├── package.json      # pnpm workspace 根
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.json
├── .prettierrc
├── .editorconfig
└── .gitignore
```

## 前置条件

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | >= 20 | 已实测 v22.22.2 |
| pnpm | >= 9 | 已实测 9.15.0 |
| Git | 2.x | 已实测 2.55.0 |
| Docker | 可选 | 仅本地基础设施（PostgreSQL/Redis）需要；本机暂未安装 |
| Foundry (forge) | 可选 | 仅合约开发/部署需要；本机暂未安装 |

> 本机环境实测：无 yarn、无 Docker、无 Foundry。以下命令均基于 pnpm。

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

本机装有 Docker 时：

```bash
docker compose up -d
```

本机无 Docker 时：跳过本步，后端暂不强求跑起来；或自行安装 PostgreSQL/Redis 并修改
`.env` 中的连接信息。

### 4. 运行前端 / 后端

```bash
# 前端（依赖 frontend-engineer 完成实现后可用）
pnpm dev:web

# 后端（依赖实现后可用）
pnpm dev:api
```

### 5. 合约（可选）

见 `contracts/README.md`。需先安装 Foundry：

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## 常用脚本

```bash
pnpm -r list          # 查看 workspace 识别到的包
pnpm build            # 构建所有包
pnpm typecheck        # 类型检查
pnpm lint             # ESLint
pnpm format           # Prettier 格式化
pnpm format:check     # Prettier 格式检查
```

## 共享包说明

- `@vortex/shared`：链常量（Base 主网 8453 / Base Sepolia 84532）、地址校验与规范化工具。
- `@vortex/config`：`getEnv` / `getEnvNumber` / `getEnvBoolean` / `getEnvironment` 等环境变量读取工具。
- `@vortex/sdk`：占位，后续实现报价、路由、交易执行。

> 共享包以 `src/index.ts` 作为入口（源码直接引用）。前端（Next.js）需在 `next.config`
> 中配置 `transpilePackages: ['@vortex/shared', '@vortex/config', '@vortex/sdk']`；
> 后端（NestJS）构建时经 `tsc` 一并转译。

## 安全规范

- 私钥（`DEPLOYER_PRIVATE_KEY`）、API Key（`ETHERSCAN_API_KEY`、WalletConnect）等敏感信息
  **一律经环境变量 / 密钥管理注入，禁止明文提交**。
- `.env` 已被 `.gitignore` 忽略；`.env.example` 只含占位符，不含真实值。
- 合约地址以部署广播产物与区块浏览器为准，**不要在仓库硬编码或编造地址**。

## 约定

- 提交前执行 `pnpm lint`、`pnpm format:check`、`pnpm typecheck`。
- 包名统一 `@vortex/*` 命名空间。
