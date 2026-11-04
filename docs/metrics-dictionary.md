# Analytics & Diagnostic Center — 指标字典（Metrics Dictionary）

> 本文档是《Analytics & Diagnostic Center 功能需求文档 V1.0》第二十二章「第二步」的交付物。
> 目的：为每个指标统一定义名称、公式、数据来源、统计口径、更新频率、钻取能力、数据完整性要求，
> 作为后续事件采集、聚合任务、Dashboard 开发的**唯一口径基准**。

**版本**：V1.0
**日期**：2026-11-04
**前置**：`docs/analytics-gap-analysis.md`（现状与缺口分析）

---

## 0. 统一口径约定

| 约定 | 规则 |
|---|---|
| 时间 | 数据库一律存 UTC；前端按用户时区展示；统计周期明确时区 |
| 金额 | 链上原始大整数一律字符串 / Decimal(78,0)；禁 Float |
| 比率 | 十进制字符串 / Decimal(78,18)；禁 Float |
| 地址 | 统一小写规范化 |
| 去重 | 链上交易以 (chain_id, tx_hash, log_index) 为唯一标识，不把每个事件当独立 Swap |
| 估值 | USD 估值必须记录价格来源与时间；历史估值不得用当前价格无说明覆盖 |
| 关联 | 一次交易意图以 `intent_id` 贯穿；无法关联的链上交易标记「归因缺失」，不强行匹配 |
| 收入/成本 | volume 与 revenue 严格分开；无收费机制时 revenue 如实置「不可用」，不伪造 0 |

---

## 1. 交易量指标（需求文档 3.1）

### 1.1 Total Trading Volume（累计交易量）

- **公式**：`Volume = Σ TradeValueUSD`（仅统计已确认有效成交）
- **估值口径**：第一版统一用「输入 Token 的 USD 估值」
- **数据来源**：`swaps`（status=CONFIRMED）+ **USD 价格预言机（需新建）**
- **当前状态**：❌ 无 USD 预言机，暂只能以「含 USDC 交易取 USDC 侧」近似（见 `analytics.service.ts` 的 `usdcSideRaw`）
- **更新频率**：1–5 分钟
- **钻取**：支持 → 时间 / Token / 协议 / 用户 / 路由
- **完整性**：非 USDC 对当前无法计价，须在 Dashboard 标注「部分未计价」

### 1.2 交易量维度

- 24H / 7D / 30D / 累计 / 小时 / 日 / 周 / 月
- **数据来源**：`analytics_daily`（日级）+ 需新增 `analytics_hourly`（小时级）
- **更新频率**：小时 1 分钟；日 5 分钟

### 1.3 交易量分析（环比 / 同比 / 维度拆解）

- **公式**：环比 = (本期 − 上期) / 上期；同比需历史数据
- **数据来源**：同上 + 时间序列聚合

---

## 2. 交易笔数（需求文档 3.2）

### 2.1 各阶段笔数（必须区分，不能混为一谈）

| 指标 | 定义 | 数据来源 | 当前状态 |
|---|---|---|---|
| Created Swaps | 创建的交易意图数 | `swaps`(status=CREATED) | ✅ 有 |
| Quoted Swaps | 已产生报价数 | `quotes` | ✅ 有（但无 user 关联） |
| Submitted Swaps | 已广播 tx 数 | `swaps`(status=PENDING+) | ✅ 有 |
| Confirmed Swaps | 链上成功数 | `swaps`(status=CONFIRMED) | ✅ 有 |
| Failed Swaps | 失败数 | `swaps`(status=FAILED) | ✅ 有 |
| Reverted Swaps | 链上回滚数 | `swaps`(status=REVERTED) | ✅ 有 |

> ⚠️ 关键缺口：Quoted 与 Created 之间**无法关联**（quotes 表无 user_address / intent_id），
> 因此「报价→成交」的转化率当前**算不出来**。

---

## 3. 成交率 / 失败率（需求文档 3.3 / 3.4）

### 3.1 链上执行成功率（Success Rate）

- **公式**：`ConfirmedSwaps / (ConfirmedSwaps + RevertedSwaps) × 100%`
- **数据来源**：`swaps`（已有，status 状态机完整）
- **当前状态**：✅ 可算
- **更新频率**：1 分钟

### 3.2 端到端成交转化率（Conversion Rate）

- **公式**：`ConfirmedSwaps / EligibleSwapIntents × 100%`
- **EligibleSwapIntents**：符合预定义条件的有效交易意图（排除无效金额 / 明显错误输入 / 测试流量）
- **数据来源**：需 `intent_id` 体系 + 前端埋点（**需新建**）
- **当前状态**：❌ 无法算（无 intent 概念）
- **注意**：与 3.1 **必须分别展示，不得混用**

### 3.3 交易失败率（Failure Rate）

- **公式**：`FailedTransactions / SubmittedTransactions × 100%`
- **失败原因分类**（需求 3.4，需结构化落库）：Insufficient Balance / Allowance / Slippage Exceeded / Quote Expired / Router Reverted / Gas Estimation Failed / RPC Error / Dropped / **User Rejected** / Unknown
- **数据来源**：`swaps.failure_reason`（**需新增字段**）+ 统一错误码表
- **当前状态**：❌ revert 原因只在读回执时临时解析，未落库
- **关键约束**：User Rejected 与链上 Reverted **必须区分**

---

## 4. 平均交易金额（需求文档 3.5）

- **公式**：`AverageTradeSize = TotalTradingVolume / SuccessfulSwapCount`
- **补充指标**：中位数、最大值、最小值、金额区间分布（避免少数大额扭曲均值）
- **数据来源**：`swaps.amount_in` + USD 估值
- **当前状态**：⚠️ 原始 token 量可算，USD 口径缺预言机

---

## 5. 核心经营 KPI（Overview，需求文档 3.6）

| KPI | 数据来源 | 当前状态 |
|---|---|---|
| Total Volume | 需 USD 预言机 | ⚠️ 部分可算 |
| 24H Volume | 需 USD 预言机 | ⚠️ 部分可算 |
| Swap Count | `swaps` | ✅ 可算 |
| Active Wallets | `swaps.user_address`（去重） | ✅ 可算 |
| New Wallets | `users` + 首次交互时间 | ⚠️ 需补 first_seen |
| Success Rate | `swaps` | ✅ 可算 |
| Conversion Rate | 需 intent_id | ❌ 无法算 |
| Failed Swaps | `swaps` | ✅ 可算 |
| Platform Revenue | 无收费机制 | ❌ 如实「不可用」 |
| Operating Cost | 无成本记录 | ❌ 需新建 `cost_records` |

> 每个 KPI 展示要求：当前值 + 对比值 + 变化百分比 + 时间范围 + 更新时间 + 口径说明。

---

## 6. 用户指标（需求文档 4）

### 6.1 用户识别

- **唯一标识**：`chain_id + wallet_address`（多链归并逻辑待产品定义）
- **数据来源**：`users.wallet_address`（当前无 chain_id 维度，**需补**）

### 6.2 用户分类

| 分类 | 定义 | 数据来源 | 当前状态 |
|---|---|---|---|
| New Wallet | 首次有效交互 | 需 `first_seen` | ❌ 需补字段 |
| Active Wallet | 周期内至少一次有效交互 | `swaps.user_address` | ✅ 可算 |
| Active Trader | 至少一次成功成交 | `swaps`(CONFIRMED) | ✅ 可算 |
| Returning Wallet | 历史交互 + 本周期再交互 | 需历史对比 | ⚠️ 需保留历史 |
| Churned Wallet | 观察周期内无再交互 | 需流失周期配置（7/30 天） | ❌ 需配置 + 历史 |

> 铁律：不能把「访问过页面」的钱包统计成「成交用户」——需区分 Active Visitor（前端埋点）。

### 6.3 用户指标

| 指标 | 公式 | 数据来源 | 当前状态 |
|---|---|---|---|
| New Wallets | 首次有效交互数 | 需 first_seen | ❌ |
| DAW / WAW / MAW | 日/周/月活跃钱包 | `swaps.user_address` | ✅ |
| Returning Wallets | 回访数 | 历史对比 | ⚠️ |
| Retention Rate | 留存率 | 需 cohort | ❌ |
| Churn Rate | 流失率 | 需流失配置 | ❌ |
| Trades Per Wallet | 每钱包笔数 | `swaps` groupBy | ✅ |
| Volume Per Wallet | 每钱包量 | `swaps` + USD | ⚠️ |

### 6.4 留存 Cohort（D1/D7/D14/D30）

- **公式**：`Retention = Cohort 中目标周期再活跃数 / Cohort 初始数`
- **数据来源**：`analytics_cohorts`（**需新建**）
- **当前状态**：❌

---

## 7. 转化漏斗（需求文档 5）

### 7.1 漏斗结构（9 步）

```
Swap Page View → Wallet Connected → Token Selected → Quote Requested
→ Quote Returned → Review Swap → Wallet Signature → Transaction Submitted
→ On-chain Confirmed
```

### 7.2 每步核心指标

| 步骤 | 核心指标 | 数据来源 | 当前状态 |
|---|---|---|---|
| 页面访问 | 访问次数 / 独立访客 | 前端埋点（需新建） | ❌ 零埋点 |
| 钱包连接 | 连接成功率 | 前端埋点 | ❌ |
| Token 选择 | 选择完成率 | 前端埋点 | ❌ |
| 报价请求 | 请求次数 / 成功率 | `quotes` + 前端埋点 | ⚠️ 后端有、前端无 |
| 报价返回 | 成功率 / 响应时间 | `quotes` | ⚠️ 无耗时字段 |
| Review Swap | 确认意向率 | 前端埋点 | ❌ |
| 钱包签名 | 签名完成率 / 拒绝率 | 前端埋点 | ❌ |
| 交易广播 | 广播成功率 | `swaps` | ✅ |
| 链上确认 | 成交率 / 确认时间 | `swaps` + `swap_events` | ✅ |

> ⚠️ 漏斗是当前**最缺数据**的模块——前端零埋点，且各步之间无 `intent_id` 串联。

### 7.3 漏斗事件关联（intent_id 核心）

- 每次交易意图必须有唯一 `intent_id`
- 从页面访问到链上成交尽量关联到同一 `intent_id`
- 无法关联的链上交易**标记归因缺失**，不强行匹配
- **数据来源**：`analytics_intents` + `analytics_funnel_events`（**需新建**）

---

## 8. 路由分析（需求文档 6，你强调的第二核心）

### 8.1 Route Analytics

| 指标 | 数据来源 | 当前状态 |
|---|---|---|
| 总路由搜索次数 | `route_candidates`（按 path_id 去重） | ✅ 有 |
| 平均候选路径数 | `route_candidates` groupBy path_id | ✅ 有 |
| 平均路由计算耗时 | 需 `route_compute_ms` | ❌ 需补字段 |
| 最优路由分布 | `route_candidates.route_score` | ✅ 有 |
| 单跳 / 多跳占比 | `route_candidates` | ✅ 有 |
| 各协议路径占比 | `route_candidates.protocol_path` | ✅ 有 |
| 无可用路径次数 | 需错误落库 | ❌ |
| 路由计算失败次数 | 需错误落库 | ❌ |

### 8.2 Route Performance（每次报价应记录）

- 输入/输出 Token、金额、候选数、各候选输出、Gas 估算、净输出、最终选定路由、计算耗时、报价区块高度、时间
- **数据来源**：`route_candidates`（已有大部分）+ **缺 `is_selected`、`route_compute_ms`、gas 换算**

### 8.3 最优路由命中率（Route Gap）

- **公式**：`RouteGap = (BestBenchmarkNetOutput − SelectedNetOutput) / BestBenchmarkNetOutput`
- **约束**：基准须可复现（同协议、同金额、同数据状态、同 Gas、同时间）
- **当前状态**：❌ 无基准、无 is_selected、无 gas USD 换算
- **诚实边界**：无完整市场信息时只能称「已接入协议范围内最优」，不得宣称全市场最优

### 8.4 Quote Competitiveness（报价竞争力）

- **公式**：`QuoteAdvantage = (VortexNetOutput − BenchmarkNetOutput) / BenchmarkNetOutput`
- **当前状态**：❌ 需基准报价

---

## 9. 协议分析（需求文档 7）

| 指标 | 数据来源 | 当前状态 |
|---|---|---|
| Trading Volume | `swap_events`（event_data.protocolType） | ✅ 可算（原始量） |
| Swap Count | `swap_events` | ✅ |
| Quote Count / Success Rate | `quotes.protocol` | ✅（quote 有 protocol 字段） |
| Quote Latency | 需耗时字段 | ❌ |
| Transaction Success / Failure Rate | `swap_events` + `swaps` | ⚠️ 需关联 |
| Average Gas | 需回执 gas | ⚠️ 部分 |
| Average Price Impact | `quotes.price_impact` | ✅ |
| Liquidity Coverage | `pools` | ⚠️ |
| Route Selection Count | 需 `is_selected` | ❌ |

> 协议对比表（需求 7.2）的「被选中次数」列**当前算不出**——又回到 `is_selected` 缺失。

---

## 10. 流动性与 Pool（需求文档 8）

| 指标 | 数据来源 | 当前状态 |
|---|---|---|
| Pool 基础信息 | `pools`（token0/1、fee、liquidity、reserve0/1） | ✅ 有 |
| Current Price / Last Synced | `pools.last_synced_block` | ✅ 有 |
| Total Pool Liquidity USD | 需 USD 预言机 | ❌ |
| Active Liquidity（V3） | 需结合 tick / 价格区间 | ⚠️ V3 不能把总 liquidity 当可交易深度 |
| Liquidity Changes | `pool_snapshots` | ✅ 有 |
| Pool Volume / Utilization | `swap_events` + `pools` | ⚠️ |
| Price Impact by Trade Size | 需按金额分段报价 | ❌ |

---

## 11. 收入与成本（需求文档 9）

> 铁律：Platform Revenue / Protocol Fee / LP Fee / User Gas Cost 四者必须区分。

| 指标 | 数据来源 | 当前状态 |
|---|---|---|
| Platform Revenue | 需收费机制 + 核验 | ❌ 首期无收费，如实「不可用」 |
| Protocol Fee | 协议手续费 | ⚠️ 需落 fee 字段 |
| LP Fee | LP 手续费 | ❌ 非平台收入 |
| User Gas Cost | 回执 gasUsed × gasPrice | ⚠️ 部分 |
| RPC / API / DB / Redis / 服务器成本 | `cost_records`（**需新建**） | ❌ |

- **核心财务公式**：`NetOperatingResult = PlatformRevenue − OperatingCost`；`RevenuePerSwap = Revenue / SuccessfulSwaps`；`CostPerSwap = Cost / SuccessfulSwaps`

---

## 12. 系统监控（需求文档 10）

| 指标 | 数据来源 | 当前状态 |
|---|---|---|
| 服务健康状态 | `health` 接口 + `system_metrics`（需新建） | ⚠️ 仅 health 接口 |
| API 监控（请求数/错误/P50/P95/P99/超时/状态码） | `system_metrics`（需新建） | ❌ |
| Quote Engine 监控（请求量/成功率/响应时间/RPC 失败） | `system_metrics` | ❌ |
| Route Engine 监控（候选数/搜索时间/失败率） | `system_metrics` | ❌ |
| RPC 监控（Provider/错误/超时/限流/区块滞后） | `system_metrics` | ❌ |
| Indexer 监控（最新区块/已索引/滞后/事件处理/重组） | `sync_state`（已有）+ `system_metrics` | ⚠️ 部分 |

> `sync_state` 已有 `last_synced_block` / `last_synced_hash` / `recent_block_hashes`，Indexer 滞后可算，但缺「事件处理失败数 / 重复数 / 重组数」。

---

## 13. 异常中心（需求文档 11）

| 字段 | 说明 | 数据来源 | 当前状态 |
|---|---|---|---|
| 异常事件 | alert_type/severity/metric/current/baseline/threshold/started/detected/scope/count/evidence/status | `anomaly_events`（需新建） | ❌ |
| 异常规则 | 阈值/环比/滚动均值/标准差/同段基线/连续检测 | `alert_rules`（需新建） | ❌ |
| 告警去重 | 指纹/冷却/持续时间/恢复通知/合并 | 逻辑层 | ❌ |

> 铁律：阈值必须可配置，不硬编码；低流量指标需设最小样本数防误报。

---

## 14. 诊断中心（需求文档 12）

### 14.1 交易级诊断（点击任意交易进入）

- 基础信息（tx_hash/钱包/链/token/amount/status/block/gas/时间）
- 报价信息（quote_id/时间/期望输出/最小接收/价格影响/gas 估算/选定路由）
- 路由信息（protocol/pool/token 路径/每段报价/gas/实际执行）
- 执行信息（approval/签名/广播/回执/revert 原因/执行时间）
- 系统日志（intent_id/api_request_id/quote_request_id/route_calc_id/rpc_request_id/error_code）

> 铁律：日志不得含私钥/助记词/签名原文。
> 当前状态：❌ 报价、路由、交易、日志之间无关联，交易级诊断无法串起来。

### 14.2 统一错误分类（需求 12.4）

| 错误码 | 排查方向 | 当前状态 |
|---|---|---|
| QUOTE_NOT_FOUND | Pool/流动性/RPC | ❌ 未定义 |
| QUOTE_EXPIRED | 有效期/网络延迟 | ❌ |
| ROUTE_NOT_FOUND | 路径搜索/Token Pair | ❌ |
| ROUTE_CALCULATION_FAILED | 算法/Pool 状态 | ❌ |
| INSUFFICIENT_BALANCE | 钱包余额 | ❌ |
| INSUFFICIENT_ALLOWANCE | Token 授权 | ❌ |
| USER_REJECTED | 钱包交互 | ❌ |
| GAS_ESTIMATION_FAILED | RPC/合约模拟 | ❌ |
| TRANSACTION_REVERTED | 合约执行原因 | ⚠️ 临时解析，未落库 |
| RPC_TIMEOUT | Provider | ❌ |
| INDEXER_LAG | Indexer | ⚠️ 可算未定义 |
| DATA_INCONSISTENCY | 同步/重复事件 | ❌ |

---

## 15. AI 诊断（需求文档 13，P1 阶段，暂不实现）

- AI 只能使用授权的结构化数据和分析接口，**不得直读原始库乱猜**。
- 结论必须带证据 + 置信度（Confirmed / High / Medium / Low / Unknown）。
- 禁止虚构数据、仅凭相关性断因果、自动改生产配置。
- **前置条件**：上述数据链路与指标全部验证通过后才开发。

---

## 16. 汇总：指标依赖的「新表 / 新字段」清单

> 按开发优先级排序，供后续 Phase 1 开发直接引用。

### 16.1 需新增字段（改现有表）

| 表 | 新增字段 | 目的 |
|---|---|---|
| `swaps` | `intent_id`、`quote_id`、`failure_reason`、`gas_used`、`effective_gas_price` | 全链路关联 + 失败原因 + 成本 |
| `quotes` | `intent_id`、`user_address`、`response_ms` | 报价归属 + 耗时 |
| `route_candidates` | `intent_id`、`quote_id`、`is_selected`、`route_compute_ms` | 路由选中 + 耗时 |
| `users` | `chain_id`、`first_seen_at` | 多链 + 新用户判定 |

### 16.2 需新建表

| 表 | 用途 | 优先级 |
|---|---|---|
| `analytics_events` | 统一业务事件 | P0 |
| `analytics_intents` | 交易意图 | P0 |
| `analytics_funnel_events` | 漏斗事件 | P0 |
| `analytics_hourly` | 小时级指标 | P0 |
| `analytics_cohorts` | 用户留存 | P1 |
| `system_metrics` | 系统监控 | P0 |
| `error_events` | 错误事件 | P0 |
| `anomaly_events` / `alert_rules` / `alert_notifications` | 异常中心 | P1 |
| `cost_records` / `revenue_records` | 收入成本 | P1 |
| `route_analytics` / `protocol_analytics` / `pool_analytics` | DEX 专业分析 | P0（可先复用现有表） |

---

## 17. 结论：第一阶段（Phase 1）必须优先建立的指标依赖

按你强调的三个关键设计 + 文档 Phase 1 验收标准，**第一阶段必须优先打通**：

1. **`intent_id` 关联体系**（第 7、14 节全部依赖它）——P0 最高优先级
2. **前端埋点 + 后端事件采集**（第 7 节漏斗全部依赖）——P0
3. **失败原因落库 + 统一错误码**（第 3、14 节依赖）——P0
4. **`is_selected` + `route_compute_ms` 路由字段**（第 8 节路由分析依赖）——P0
5. **`system_metrics` + `error_events` 系统监控**（第 12 节，业务/技术问题区分依赖）——P0
