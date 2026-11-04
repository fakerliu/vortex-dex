# VORTEX DEX API 文档

## 基础信息

- **Base URL**：`http://localhost:3001/api/v1`（全局前缀 `api/v1`，端口由 `API_PORT` 或 `PORT` 控制，缺省 3001）。
- **协议**：HTTP/JSON，已开启 CORS。
- **链 ID**：`8453` = Base Mainnet（缺省），`84532` = Base Sepolia。

### 统一响应信封

成功响应统一包装为：

```json
{ "success": true, "data": { ... } }
```

失败响应统一结构（由全局异常过滤器处理）：

```json
{
  "success": false,
  "error": { "code": "RPC_UNAVAILABLE", "message": "..." },
  "path": "/api/v1/quote",
  "timestamp": "2026-11-04T00:00:00.000Z"
}
```

### 错误码

| 错误码 | HTTP 状态 | 含义 |
| --- | --- | --- |
| `BAD_REQUEST` / `VALIDATION_ERROR` | 400 | 参数非法 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 资源冲突（如交易已提交） |
| `RPC_UNAVAILABLE` | 503 | 链 RPC 不可达 |
| `NO_ROUTE` | — | 无可用路径 |
| `QUOTE_EXPIRED` | 410 | 报价已过期 |
| `UNSUPPORTED_ROUTE` | — | 路径暂不支持 |
| `INTERNAL_ERROR` | 500 | 内部错误 |

### 金额与精度约定

- 链上原始大整数金额一律为**字符串**（如 `"2291393052"`），避免精度丢失。
- 比率/小数一律为**十进制字符串**（如 `priceImpact: "0.000248"`）。
- 手续费 `swapFee` 为 ppm 字符串（`1_000_000 = 100%`）；`swapFeeFraction` 为十进制小数字符串（如 `"0.00015"` = 0.015%）。
- 地址统一小写规范化。

---

## Health

### GET /api/v1/health

健康检查（含数据库连通性）。

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `'ok' \| 'degraded'` | 整体状态 |
| `database` | `'up' \| 'down'` | 数据库连通性 |
| `uptime` | number | 进程运行秒数 |
| `timestamp` | string | ISO 8601 时间 |

---

## Token 模块

Token 元数据与余额。`GET /search`、`/verified` 静态路由先于 `:address` 匹配。

### GET /api/v1/tokens

分页列出 Token。查询参数：`chainId`、`page`、`limit`（均为可选整数）。

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `TokenDto[]` | Token 列表 |
| `page` / `limit` / `total` | number | 分页信息 |

`TokenDto`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `chainId` | number | 链 ID |
| `address` | string | 小写地址 |
| `symbol` / `name` | string | 符号 / 名称 |
| `decimals` | number | 精度 |
| `logoURI` | string \| null | Logo 地址 |
| `verified` | boolean | 是否已验证 |
| `risk` | boolean | 风险标记（需用户确认） |
| `source` | string \| null | 元数据来源（onchain / fallback） |

### GET /api/v1/tokens/search

按关键词搜索 Token。查询参数：`q`（必填，非空）、`chainId`（可选）。响应为 `TokenDto[]`。

### GET /api/v1/tokens/verified

列出已验证 Token。查询参数：`chainId`（可选）。响应为 `TokenDto[]`。

### GET /api/v1/tokens/:address

查询单个 Token。查询参数：`chainId`（可选）。响应为 `TokenDto`。

### GET /api/v1/tokens/:address/balance

查询钱包余额。查询参数：`wallet`（必填，非空）、`chainId`（可选）。

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `chainId` | number | 链 ID |
| `address` | string | Token 地址（小写） |
| `wallet` | string | 钱包地址（小写） |
| `symbol` | string | 符号 |
| `decimals` | number | 精度 |
| `raw` | string | 链上原始大整数字符串 |
| `formatted` | string | 按 decimals 格式化后的字符串 |

---

## 报价引擎

### POST /api/v1/quote

生成报价（Sprint 4 仅支持单跳，多池聚合选最优）。

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tokenIn` | string | 是 | 输入 token 地址 |
| `tokenOut` | string | 是 | 输出 token 地址 |
| `amountIn` | string | 是 | 输入金额（链上原始大整数） |
| `chainId` | number | 否 | 缺省 8453 |
| `slippageBps` | number | 否 | 滑点 bps（1=0.01%） |
| `protocols` | string[] | 否 | 协议白名单（如 `["aerodrome_classic","aerodrome_cl"]`） |
| `maxPathLength` | number | 否 | 最大路径长度（Sprint 4 仅支持 1） |

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 报价 ID |
| `chainId` | number | 链 ID |
| `tokenIn` / `tokenOut` | string | token 地址 |
| `amountIn` / `amountOut` | string | 输入 / 输出金额（原始大整数） |
| `price` | string | 人读价格（tokenOut 兑 tokenIn） |
| `minimumReceived` | string | 考虑滑点后的最小输出 |
| `priceImpact` | string | 价格影响（十进制字符串） |
| `swapFee` | string | 手续费（ppm 字符串） |
| `swapFeeFraction` | string | 手续费（十进制小数） |
| `gasEstimate` | string | gas 估算 |
| `protocol` / `protocolName` | string | 来源协议类型 / 名称 |
| `route` | `{ pool, kind }[]` | 单跳路径 |
| `source` | string | 报价来源（constant-product / quoter / onchain-getAmountOut） |
| `blockNumber` | number \| null | 报价时区块高度 |
| `quoteTimestamp` | string | 报价时间 |
| `quoteExpiration` | string | 过期时间 |

### GET /api/v1/quote/:id

查询历史报价，结构同 `POST /api/v1/quote`。已过期返回 410 `QUOTE_EXPIRED`。

---

## 路由引擎

### POST /api/v1/route

计算多跳路由候选（按 NetOutput 排序）。

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tokenIn` / `tokenOut` | string | 是 | token 地址 |
| `amountIn` | string | 是 | 输入金额（原始大整数） |
| `chainId` | number | 否 | 缺省 8453 |
| `maxPathLength` | number | 否 | 最大跳数（池子数量），默认 2，上限 3 |
| `protocols` | string[] | 否 | 协议白名单 |
| `hubTokens` | string[] | 否 | 多跳中间 token（默认 WETH + USDC） |

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `pathId` | string | 本次路径计算标识 |
| `chainId` | number | 链 ID |
| `tokenIn` / `tokenOut` | string | token 地址 |
| `amountIn` | string | 输入金额 |
| `blockNumber` | number \| null | 区块高度 |
| `gasPriceWei` | string \| null | gas 价格 |
| `gasPriceSource` | string \| null | gas 价格来源 |
| `gasConversionMethod` | string | gas 换算方法 |
| `candidates` | `RouteCandidateDto[]` | 候选路径（按 NetOutput 排序） |
| `quoteTimestamp` | string | 计算时间 |

`RouteCandidateDto`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tokenPath` / `poolPath` / `protocolPath` | string[] | 路径三数组 |
| `amountIn` / `amountOut` | string | 输入 / 输出金额 |
| `estimatedGas` | string | 估算 gas |
| `gasCostInOutputToken` | string | gas 换算为输出 token 的原始单位 |
| `netOutput` | string | `amountOut - gasCostInOutputToken`（无法换算时 = amountOut） |
| `priceImpact` | string | 价格影响 |
| `routeScore` | string | 路径评分 |
| `gasConverted` | boolean | 是否成功将 gas 从 netOutput 扣除 |
| `hops` | `RouteHopDto[]` | 逐跳明细（仅 POST 返回） |

### GET /api/v1/route/:pathId

查询某次路由计算的候选，结构同 `POST /api/v1/route`（`hops` 不返回）。

---

## 交易执行

非托管：后端只产出 calldata，不接触私钥，只接收公开 `tx_hash`。

### POST /api/v1/swaps/prepare

准备交易（报价 + 余额 + allowance + calldata）。

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tokenIn` / `tokenOut` | string | 是 | token 地址 |
| `amountIn` | string | 是 | 输入金额（原始大整数） |
| `userAddress` | string | 是 | 用户钱包地址 |
| `slippageBps` | number | 否 | 滑点 bps |
| `chainId` | number | 否 | 缺省 8453 |
| `route` | `{ tokenPath, poolPath, protocolPath }` | 否 | 显式执行路径 |
| `pathId` | string | 否 | 恢复某次多跳路径候选 |
| `sqrtPriceLimitX96` | string | 否 | CL 价格上限（缺省 0 不设限） |

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `chainId` | number | 链 ID |
| `userAddress` | string | 用户地址 |
| `tokenIn` / `tokenOut` | string | token 地址 |
| `amountIn` / `amountOut` | string | 输入 / 期望输出金额 |
| `minimumReceived` | string | 考虑滑点后的最小输出 |
| `priceImpact` | string | 价格影响 |
| `slippageBps` | number | 滑点 |
| `deadline` | number | 交易 deadline（unix 秒） |
| `protocol` | string | 协议类型（aerodrome_classic / aerodrome_cl） |
| `route` | `SwapHopDto[]` | 单跳执行明细 |
| `balance` | string | tokenIn 实时余额 |
| `allowance` | string | tokenIn 对 Router 的当前授权 |
| `spender` | string | 授权目标（Router）地址 |
| `needsApproval` | boolean | 是否需要先 Approve |
| `approvalAmount` | string | 授权额度（本次 amountIn） |
| `transaction` | object | 可直接签名广播的交易（`to` / `value` / `data` / `functionName` / `selector` / `gasLimit`） |
| `approval` | object \| null | 若需 approve，附 approve 交易 calldata |
| `quoteTimestamp` | string | 报价时间 |
| `notes` | string[] | 备注 |

### POST /api/v1/swaps/submit

回写已广播交易（只收公开 `tx_hash`）。

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `txHash` | string | 是 | 已广播交易哈希（0x + 64 hex） |
| `userAddress` | string | 是 | 用户地址 |
| `tokenIn` / `tokenOut` | string | 是 | token 地址 |
| `amountIn` / `amountOut` | string | 是 | 输入 / 期望输出金额 |
| `chainId` | number | 否 | 缺省 8453 |
| `status` | string | 否 | 初始状态，默认 `PENDING` |

响应 `data` 为 `SwapDto`（见下）。

### GET /api/v1/swaps/history

按用户查历史。查询参数：`user`（必填）、`chainId`、`page`、`limit`。

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `SwapDto[]` | 交易列表 |
| `page` / `limit` / `total` | number | 分页信息 |

### GET /api/v1/swaps/:id

查询单笔交易详情，响应为 `SwapDetailDto`（`SwapDto` 增强版）。

`SwapDto` 关键字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 交易 ID |
| `userAddress` | string | 用户地址 |
| `tokenIn` / `tokenOut` | string | token 地址 |
| `amountIn` / `amountOut` | string | 金额 |
| `txHash` | string | 交易哈希 |
| `status` | string | 状态（见状态机） |
| `chainId` | number | 链 ID |
| `createdAt` | string | 创建时间 |
| `confirmedAt` | string \| null | 确认时间 |
| `tokenInMeta` / `tokenOutMeta` | object \| null | token 元数据 |
| `formattedAmountIn` / `formattedAmountOut` | string \| null | 格式化金额 |
| `events` | `SwapEventDto[]` | 关联链上事件 |

`SwapDetailDto` 额外字段：`blockNumber`、`gasUsed`、`effectiveGasPrice`、`failureReason`、`explorerUrl`（basescan 链接）、`chainEvents`（Indexer `swap_events`，按 log_index 升序）、`statusSync`（`{ source: 'receipt'|'indexer'|'none'|'rpc_error', syncedAt }`）。

**交易状态**：`CREATED` / `QUOTED` / `APPROVAL_REQUIRED` / `APPROVED` / `PENDING` / `CONFIRMED` / `FAILED` / `REVERTED` / `EXPIRED` / `REPLACED` / `DROPPED`。

### POST /api/v1/swaps/reconcile

批量核验所有 `PENDING` 交易。查询参数：`chainId`、`limit`（可选）。

### POST /api/v1/swaps/backfill

消费 Indexer 事件，回填 `swap_events.swap_id` + 生成/更新 `swaps`。查询参数：`limit`（可选）。

### POST /api/v1/swaps/:id/reconcile

核验单笔交易。

---

## 用户系统

### POST /api/v1/users

注册 / 获取用户（幂等）。请求体：`{ walletAddress?: string }`。

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `address` | string | 钱包地址（小写） |
| `createdAt` | string \| null | 注册时间（未注册为 null） |
| `stats` | object | 交易统计 |

`stats`：`totalSwaps`（去重交易数）、`confirmed`、`failed`、`pending`、`sourcePlatform`（平台 swaps 表记录数）、`sourceChain`（链上 swap_events 唯一 tx 数）。

### GET /api/v1/users/:address

钱包识别 + 交易统计，响应结构同 `POST /api/v1/users`。

### GET /api/v1/users/:address/swaps

用户交易列表（分页，时间倒序）。查询参数：`chainId`、`page`、`limit`。

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `UserSwapRecordDto[]` | 交易列表（统一平台 + 链上两类来源） |
| `page` / `limit` / `total` | number | 分页信息 |

`UserSwapRecordDto`：`id`、`source`（`platform` \| `chain`）、`txHash`、`chainId`、`tokenIn` / `tokenOut`、`amountIn` / `amountOut`、`status`、`blockNumber`、`timestamp`、`explorerUrl`、`pool`、`protocolType`。

---

## 经营分析

量（volume）与收入（revenue）严格分离；无 USD 预言机时 volume 只给原始 token 量 + 笔数，`revenue.available = false`。

### GET /api/v1/analytics/summary

经营总览。查询参数：`chainId`（可选）。

响应 `data`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `generatedAt` | string | 生成时间 |
| `chainId` | number \| null | 链 ID（null = 全链） |
| `volume` | object | 量：`platformSwapCount`、`platformUniqueUsers`、`chainSwapEventCount`、`chainUniqueTxs`、`byToken`、`byPair` |
| `revenue` | object | 收入：`available`、`definition`、`note` |
| `platform` | object | 平台：`totalSwaps`、`confirmed`、`pending`、`failed`、`registeredUsers`、`statusBreakdown` |
| `chain` | object | 链上：`eventTypeBreakdown`、`indexedPools`、`protocols`、`note` |
| `definitions` | `MetricDefinitionDto[]` | 每个指标的来源与口径定义 |

### GET /api/v1/analytics/daily

日度统计。查询参数：`chainId`、`from`、`to`、`limit`。响应 `data`：`generatedAt`、`chainId`、`from`、`to`、`rows`、`note`。

### GET /api/v1/analytics/protocol-distribution

各协议交易量分布。查询参数：`chainId`。响应 `data`：`generatedAt`、`chainId`、`items`（`{ protocolType, swapEvents, uniqueTxs }`）、`note`。

### POST /api/v1/analytics/aggregate

触发日聚合落库 `analytics_daily`（幂等）。查询参数：`chainId`、`from`、`to`。响应 `data`：`generatedAt`、`chainId`、`from`、`to`、`aggregatedDates`、`upsertedRows`、`totalSwapsScanned`、`confirmedSwaps`、`unpricedSwaps`、`note`。

---

## Indexer

### GET /api/v1/indexer/status

同步状态监控。响应 `data`：`chainId`、`running`、`lastSyncedBlock`、`lastSyncedHash`、`latestBlock`、`lag`、`indexedPools`、`totalEvents`、`lastError`、`lastScan`。

### POST /api/v1/indexer/scan

手动触发一轮扫描（幂等，重复调用不重复写入）。响应 `data` 为 `ScanSummary`（含 `fromBlock` / `toBlock` / `indexedEvents` / `writtenEvents` / `lag` 等）。

---

## 占位接口（未实现）

以下接口仅路由占位，返回 `{ implemented: false, ... }`：

- `GET /api/v1/protocols`、`GET /api/v1/protocols/:id`
- `GET /api/v1/pools`、`GET /api/v1/pools/:id`
