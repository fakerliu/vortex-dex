# VORTEX DEX 部署手册

## 环境要求

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | >= 20 | 实测 v22.22.2 |
| pnpm | >= 9 | 实测 9.15.0 |
| Docker | 可选 | 本地基础设施（PostgreSQL/Redis） |
| Foundry (forge) | 可选 | 仅合约开发（当前无 .sol） |

## 本地部署

### 1. 安装依赖

```bash
pnpm install
```

> 本机若使用国内镜像，`.npmrc` 已配置 `registry=https://registry.npmmirror.com/`。

### 2. 配置环境变量

```bash
cp .env.example .env
```

关键项（完整清单见 `.env.example`）：

| 变量 | 缺省 | 说明 |
| --- | --- | --- |
| `APP_ENV` | `local` | local / testnet / mainnet |
| `PORT` / `API_PORT` | `3000` / `3001` | 前端 / 后端端口 |
| `BASE_MAINNET_RPC_URL` | `https://mainnet.base.org` | Base 主网 RPC |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | Base Sepolia RPC |
| `DATABASE_URL` | `postgresql://vortex:vortex@localhost:5432/vortex?schema=public` | PostgreSQL 连接串 |
| `REDIS_URL` | `redis://localhost:6379` | Redis 连接串 |
| `NEXT_PUBLIC_API_BASE_URL` | 空 | 前端访问后端的基础 URL |

### 3. 启动基础设施

```bash
docker compose up -d
```

`docker-compose.yml` 仅起基础设施：

- PostgreSQL 16（`vortex-postgres`，端口 5432，库/用户/密码均 `vortex`）
- Redis 7（`vortex-redis`，端口 6379）

无 Docker 时可自行安装 PostgreSQL 16 / Redis 7，并在 `.env` 中修改连接信息。

### 4. 数据库迁移 + 种子

```bash
# 生成 Prisma Client
pnpm --filter @vortex/api prisma:generate

# 应用迁移（开发）
pnpm --filter @vortex/api prisma:migrate

# 写入种子数据（Base Mainnet 7 个 + Sepolia 2 个真实 Token）
pnpm --filter @vortex/api seed
```

迁移文件位于 `apps/api/prisma/migrations/`，共 4 个：

1. `20261103181524_init_postgres` — 初始化 10 张表
2. `20261103182102_fix_decimal_scale_for_ratios` — 比率字段 Decimal(78,18)
3. `20261103190913_add_quote_metadata_fields` — 报价元数据字段
4. `20261104100000_indexer_sync_state` — 索引同步状态表

### 5. 启动后端

```bash
# 开发（watch 模式）
pnpm dev:api

# 或编译后运行（更稳，避免 watch 反复清 dist）
pnpm --filter @vortex/api build
node apps/api/dist/main.js
```

后端监听 `http://localhost:3001/api/v1`。可用 `curl http://localhost:3001/api/v1/health` 验证。

> 注意：本机若配置了 `http_proxy` / `https_proxy` 环境变量，viem 的 HTTP 请求会走代理导致
> RPC 超时。启动后端前需清空代理变量：
>
> ```bash
> env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY node apps/api/dist/main.js
> ```

### 6. 启动前端

```bash
# 配置后端地址（写入 apps/web/.env）
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1

pnpm dev:web
```

前端监听 `http://localhost:3000`，根路径重定向到 `/swap`。

> 注意：本机「安全删除守卫」会拦截 next dev 清理 `.next`（批量删除），若启动失败可先
> 手动 `rm -rf apps/web/.next` 再启动。

### 7. 冒烟测试（可选）

```bash
pnpm --filter @vortex/api smoke
```

`apps/api/scripts/smoke.ts` 校验真实 CRUD、唯一约束与关系联查。

## 生产部署

> 说明：`infrastructure/docker/` 目前为占位目录，尚未提供生产 Dockerfile / 多阶段构建模板。
> 以下为基于现有脚本的部署步骤，容器化编排待后续补充。

### 1. 构建

```bash
pnpm build                       # 构建所有包
pnpm --filter @vortex/web build  # 前端（next build → .next）
pnpm --filter @vortex/api build  # 后端（nest build → dist）
```

### 2. 数据库迁移（生产用 `migrate deploy`，不做交互式 diff）

```bash
pnpm --filter @vortex/api prisma:generate
pnpm --filter @vortex/api prisma:deploy
pnpm --filter @vortex/api seed
```

### 3. 启动后端

```bash
node apps/api/dist/main.js        # 建议由进程管理器（PM2 / systemd / K8s）托管
```

### 4. 启动前端

```bash
pnpm --filter @vortex/web start   # next start（需先 next build）
```

### 5. 环境变量（生产）

除本地项外，生产需额外关注：

| 变量 | 说明 |
| --- | --- |
| `APP_ENV=mainnet` | 明确运行环境 |
| `POSTGRES_PASSWORD` | 强口令，或经密钥管理注入 |
| `REDIS_PASSWORD` | 生产必填 |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect 项目 ID（前端钱包连接） |
| `BASE_MAINNET_RPC_URL` / `BASE_SEPOLIA_RPC_URL` | 建议使用付费/私有 RPC，公共端点有 getLogs 限流 |
| `INDEXER_RPC_URLS` | 索引器 RPC 端点池（逗号分隔，可选） |
| `CONTRACT_ROUTER_ADDRESS` 等 | 部署后回填（当前无自有合约，保留占位） |

## 安全注意事项

- 私钥（`DEPLOYER_PRIVATE_KEY`）、API Key（`ETHERSCAN_API_KEY`）等敏感信息一律经环境变量
  / 密钥管理注入，禁止明文提交；`.env` 已被 `.gitignore` 忽略。
- 生产环境数据库与 Redis 务必设置强口令。
- 后端为「非托管」架构，不持有用户私钥；`DEPLOYER_PRIVATE_KEY` 仅供未来合约部署脚本使用，
  与用户交易无关。

## 常见问题

- **后端 RPC 超时**：检查进程是否继承了 `http_proxy` / `https_proxy`，用 `env -u` 清空后重启。
- **前端 next dev 启动失败**：安全删除守卫拦截 `.next` 清理，先手动 `rm -rf apps/web/.next`。
- **后端 watch 模式反复触发删除**：改用 `node dist/main.js`（非 watch）运行。
- **seed RPC 不可达**：seed 会用目录里已核对的 symbol/name/decimals 兜底，`Token.source=fallback`，不阻塞。
