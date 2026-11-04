# VORTEX DEX 架构设计

## 总览

VORTEX DEX 是基于 Base 链的非托管 DEX Aggregator。用户在前端发起交易意向，后端聚合
多个流动性池的报价与路径，产出最优交易路径和可签名 calldata，由用户钱包在链上广播。

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 apps/web（Next.js）                  │
│  /swap 页面 · wagmi 钱包 · useQuote / useSwapExecution hooks     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP（统一信封 { success, data / error }）
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   后端 apps/api（NestJS，/api/v1）              │
│                                                                 │
│  modules/          业务层（controller + service）                │
│   token · quote · route · swap · user · analytics               │
│   protocol · pool（占位）· health · indexer                     │
│                                                                 │
│  dex/              统一 DEX 适配层                               │
│   aerodrome-classic · aerodrome-cl · uniswap-v3 · dex-pool     │
│   math（定点运算）· calldata（交易编码）                          │
│                                                                 │
│  chain/            RPC 客户端 · ERC-20 读取 · token 目录         │
│  prisma/           PostgreSQL 数据访问                           │
└───────────────┬──────────────────────────────┬──────────────────┘
                │ RPC（viem）                   │ SQL
                ▼                              ▼
   ┌────────────────────┐           ┌──────────────────┐
   │ Base 链（8453/84532）│          │ PostgreSQL 16     │
   │ Aerodrome / Uniswap │          │ Redis 7（预留）    │
   │ V3 合约             │          └──────────────────┘
   └────────────────────┘
```

后端以「非托管」为铁律：不接收私钥/助记词/已签名交易，只接收公开 `tx_hash`。
金额一律用「链上原始大整数」字符串表示，比率用「十进制字符串」，禁止 Float。

## 分层与模块

### 1. chain 层（`apps/api/src/chain`）

链上读取的统一入口，`@Global` 模块。

- `ChainRpcService`：viem 公共客户端单例，按 `chain_id` 缓存，10s 超时 + 重试 + multicall。RPC 地址可由 `BASE_MAINNET_RPC_URL` / `BASE_SEPOLIA_RPC_URL` 注入，缺省走公开 RPC。
- `Erc20ReaderService`：ERC-20 的 `name` / `symbol` / `decimals` / `balanceOf` 读取。
- `token-catalog.ts`：精选代币目录（Base Mainnet 7 个 + Sepolia 2 个真实合约地址），供 seed 与 Token 打标使用。
- `chain.constants.ts`：支持的链（8453 / 84532）、默认 RPC、区块浏览器、`buildExplorerTxUrl`。
- `chain.errors.ts` / `address.ts`：RPC 异常包装（`ChainReadError` → 503 `RPC_UNAVAILABLE`）与地址规范化。

### 2. DEX 适配层（`apps/api/src/dex`）

所有协议适配器实现统一接口 `DexAdapter`（`dex-adapter.interface.ts`）：

| 方法 | 职责 |
| --- | --- |
| `getProtocolInfo()` | 协议元信息（factory/router/quoter 地址 + 是否已链上核验） |
| `discoverPools(tokenA, tokenB)` | 发现两 token 之间的所有池子 |
| `getPoolState(poolAddress)` | 读取池子实时状态（reserve / sqrtPriceX96 / tick 等） |
| `getQuote(params)` | 单池报价 |
| `estimateGas(params)` | Gas 估算 |

当前实现三类适配器：

- **AerodromeClassicAdapter**（Base Mainnet 8453）：Velodrome v2 fork，恒定乘积（volatile）与 stable（stableswap 不变式）两类池。
- **AerodromeClAdapter**（Base Mainnet 8453）：Aerodrome Slipstream 集中流动性 CL（Uniswap v3 fork），`int24 tickSpacing` 维度。
- **UniswapV3Adapter**（Base Sepolia 84532）：Uniswap V3，`uint24 fee` 维度（与 Aerodrome CL 的 `tickSpacing` 维度不同，二者不可混淆）。

配套服务：

- `AerodromeService` / `UniswapV3Service`：协议注册 + 池子落库（`dex_protocols` / `pools` 表）。
- `DexPoolService`：池发现 + 逐池报价，供 Quote / Route / Swap 复用，按链分派到对应适配器。
- `math.ts`：BigInt 定点运算（含 `formatFraction` 等，避免浮点误差）。
- `calldata.ts`：交易 calldata 编码（`swapExactTokensForTokens` / `exactInputSingle` / `approve`，selector 已 `cast sig` 核验）。
- `types.ts`：统一类型（`PoolKind = 'classic-volatile' | 'classic-stable' | 'cl'` 等）。

**费率规范化约定**：`fee` 统一用 ppm（`1_000_000 = 100%`）。classic 池链上 `getFee` 返回 bps（30 = 0.30%），适配器内 ×100 转 ppm；CL 池 `fee()` 本身就是 ppm（3000 = 0.30%）。

**池子类型**（`PoolKind`）：

| kind | 定价模型 | 关键状态字段 |
| --- | --- | --- |
| `classic-volatile` | 恒定乘积 x·y=k | `reserve0` / `reserve1` |
| `classic-stable` | stable 不变式（非 x·y=k） | `reserve0` / `reserve1` + `stable=true` |
| `cl` | 集中流动性（sqrtPriceX96） | `liquidity` / `sqrtPriceX96` / `tick` |

### 3. 报价引擎（`modules/quote`）

`POST /api/v1/quote` 对单跳（Sprint 4 仅支持单跳）聚合所有候选池的报价，选 `amountOut` 最大者。
报价来源按池子类型区分并写入 `quote.source`：

- `constant-product`：classic 恒定乘积池，本地定点运算。
- `quoter`：CL 池经 Quoter 合约 `quoteExactInputSingle` 链上仿真（返回更准且含 gas）。
- `onchain-getAmountOut`：classic 池经链上 `getAmountOut` 读取。

报价结果落库 `quotes` 表，支持 `GET /api/v1/quote/:id` 查询历史报价（过期返回 410 `QUOTE_EXPIRED`）。

### 4. 路由引擎（`modules/route`）

`POST /api/v1/route` 计算多跳路径候选：

- 通过 BFS 在 hub 代币集（默认 WETH + USDC，可用 `hubTokens` 覆盖）上扩展多跳路径。
- `maxPathLength`（= 池子数量）默认 2，上限 3。
- 每条候选路径计算 `NetOutput = amountOut - gasCostInOutputToken`：把 gas 换算成输出 token 的原始单位后从 `amountOut` 中扣除；无法换算时 `gasConverted=false` 且 `NetOutput = amountOut`。
- 候选按 `NetOutput` 排序，`pathId` 关联本次计算，落库 `route_candidates` 表，供 `GET /api/v1/route/:pathId` 查询。

### 5. 交易执行（`modules/swap`）

非托管交易全链路：

- `POST /api/v1/swaps/prepare`：综合报价 + 余额 + allowance + calldata，返回可直接签名广播的 `transaction`（`to` / `data` / `gasLimit`）与（如需要）`approval` 交易。`gasLimit` 为参考估算值，非链上 `eth_estimateGas`。
- `POST /api/v1/swaps/submit`：接收公开 `tx_hash` 写库，初始状态默认 `PENDING`。

**Gas 估算**（`estimateGas`）来源分三类（`dex/types.ts`）：`static`（默认 `DEFAULT_SWAP_GAS_LIMIT = 250_000`，Sprint 3 未实现 `eth_estimateGas` 仿真）、`eth_estimateGas`、`quoter-simulation`。

**交易状态机**（`swap.types.ts`，11 态）：

```
CREATED ─► QUOTED ─► APPROVAL_REQUIRED ─► APPROVED ─► PENDING ─► CONFIRMED
                 │                              │            ├─► FAILED / REVERTED
                 └────────（无需授权则跳过）─────►            ├─► EXPIRED / DROPPED / REPLACED
                                                            └─►（异常终止）
```

终态：`CONFIRMED` / `FAILED` / `REVERTED` / `EXPIRED` / `REPLACED` / `DROPPED`。
状态转换必须基于「实际钱包操作 / RPC 结果 / 链上回执」，不能广播即成功。

### 6. 事件索引器（`indexer`）

只索引 **Base Mainnet 的 Aerodrome 池子**（`INDEXER_CHAIN_ID = 8453`）。

- 区块扫描 + 断点续传：`sync_state` 表记录每链已同步高度与最近 N 个区块 hash，重启后从该高度继续。
- 重组检测：`REORG_SAFE_DEPTH = 12`，每次只推进到 `head - 12`，若后续区块 hash 不一致则回退重扫。
- 事件类型：`Swap` / `Sync` / `Mint` / `Burn` / `Fees`（classic）、`Collect`（CL），topic0 均已 `cast keccak` 计算 + 实抓日志核验。
- 幂等写入：`swap_events` 表 `@@unique([tx_hash, log_index])`。
- RPC 限流：多端点池（`DEFAULT_INDEXER_RPC_URLS`），`SCAN_CHUNK_BLOCKS = 200`、`SCAN_INTERVAL_MS = 12000`、`MIN_RPC_INTERVAL_MS = 250`。
- 控制接口：`GET /api/v1/indexer/status`（同步状态）、`POST /api/v1/indexer/scan`（手动触发一轮，幂等）。

### 7. 交易对账（`modules/swap/swap-reconciler`）

- `POST /api/v1/swaps/backfill`：消费 Indexer 落库的 `swap_events`，回填 `swap_events.swap_id`，并生成/更新 `swaps` 记录。
- `POST /api/v1/swaps/reconcile`：批量核验所有 `PENDING` 交易（查链上回执更新状态）。
- `POST /api/v1/swaps/:id/reconcile`：核验单笔交易。

### 8. 用户系统（`modules/user`）

- `POST /api/v1/users`：幂等注册/获取用户（`users.wallet_address` 唯一）。
- `GET /api/v1/users/:address`：钱包识别 + 交易统计（平台 `swaps` ∪ 链上 `swap_events`，按 `tx_hash` 去重）。
- `GET /api/v1/users/:address/swaps`：用户交易列表（分页，时间倒序，统一平台与链上两类来源）。

### 9. 经营分析（`modules/analytics`）

- 量（volume）与收入（revenue）严格分离；无 USD 预言机，volume 只给原始 token 量 + 笔数，`revenue.available = false` 不伪造 USD。
- 每个指标带 `source`（表.字段）并在响应 `meta.definitions` / `definitions` 给出统一定义。
- `POST /api/v1/analytics/aggregate` 触发日聚合落库 `analytics_daily`（幂等 upsert），查询优先预聚合、实时回退。

## 数据模型（PostgreSQL）

Prisma schema 定义 11 张表（`apps/api/prisma/schema.prisma`）：

| 表 | 用途 |
| --- | --- |
| `users` | 用户（钱包地址唯一） |
| `tokens` | Token 元数据（`@@unique([chain_id, address])`） |
| `dex_protocols` | DEX 协议注册 |
| `pools` | 流动性池（`@@unique([chain_id, pool_address])`） |
| `quotes` | 报价历史 |
| `route_candidates` | 路由候选（`path_id` 关联） |
| `swaps` | 交易记录（`tx_hash` 唯一） |
| `swap_events` | 链上原始事件（`@@unique([tx_hash, log_index])` 幂等） |
| `pool_snapshots` | 池快照（`@@unique([pool_id, block_number])`） |
| `sync_state` | 索引同步状态（断点续传 + 重组检测） |
| `analytics_daily` | 日度统计（`@@unique([date, chain_id])`） |

金额/精度字段统一 `Decimal @db.Decimal(78, 0)`（链上原始大整数），比率类用
`Decimal @db.Decimal(78, 18)`。地址统一小写规范化入库。

## 支持的链与协议

| 链 | chainId | 协议适配器 |
| --- | --- | --- |
| Base Mainnet | 8453 | Aerodrome Classic、Aerodrome Slipstream CL |
| Base Sepolia | 84532 | Uniswap V3（测试网真机闭环） |

已核验的协议合约地址见源码 `apps/api/src/dex/aerodrome/constants.ts` 与
`apps/api/src/dex/uniswap-v3/constants.ts`（Aerodrome 地址经 `scripts/verify-aerodrome.ts`
链上实读核验；Uniswap V3 Sepolia 地址经 `cast` 链上核验）。
