# Analytics & Diagnostic Center — 现状与缺口分析

> 本文档是《Analytics & Diagnostic Center 功能需求文档 V1.0》第二十二章「第一步」的交付物。
> 用途：作为 Analytics & Diagnostic Center 后续开发的**基准**，明确「已有 / 缺失 / 可复用 / 需新增 / 关联缺口」。

**版本**：V1.0
**日期**：2026-11-04
**范围**：VORTEX DEX 现有工程（apps/api + apps/web）

---

## 一、当前已有的数据（真实盘点，基于代码）

现有 Prisma 模型共 **11 张表**，能支撑的分析能力如下：

| 表 | 现状 | 能支撑什么 |
|---|---|---|
| `users` | 有 | 注册 / 去重用户数 |
| `tokens` | 有 | Token 元数据（symbol / decimals） |
| `dex_protocols` | 有 | 协议数 |
| `pools` + `pool_snapshots` | 有 | 池子数、流动性快照（reserve0/1） |
| `quotes` | 有 | 报价记录（amount_in/out、gas、price_impact、protocol、block_number） |
| `route_candidates` | 有，**且已落库** | 路由候选（token/pool/protocol 路径、amount、gas、net_output、route_score） |
| `swaps` | 有 | 平台交易（status 状态机完整：CREATED→…→CONFIRMED/REVERTED 等 11 态） |
| `swap_events` | 有 | 链上原始事件（Swap/Sync/Mint/Burn…，event_data 为 JSON 字符串） |
| `sync_state` | 有 | Indexer 同步进度（断点续传 + 重组检测） |
| `analytics_daily` | 有 | 日度预聚合（volume_usd、swap_count、unique_users） |

**已实现的后端 Analytics 接口**（`apps/api/src/modules/analytics/`）：

- `GET /analytics/summary`
- `GET /analytics/daily`
- `GET /analytics/protocol-distribution`
- `POST /analytics/aggregate`

---

## 二、缺少的数据（对照需求文档逐项核）

### 关键缺口 1：没有 `intent_id`（全链路追踪 ID）—— 核心，完全缺失

全代码库 grep `intent` 结果为**空**。现状：

- `swaps` 表**没有** `quote_id`、`intent_id` 字段，无法关联「这次成交来自哪次报价」。
- `quotes` 表**没有** `user_address`、`intent_id`，无法知道谁发起的报价、是否最终成交。
- `route_candidates` 只有 `path_id`（内部路由计算用），**没有**与 quote/swap 的关联。
- 前端**没有任何埋点**（grep 前端无 track/event/intent 逻辑）。

**后果**：需求文档第五章「漏斗分析」、第十二章「交易级诊断」（从异常→交易→报价→路由→日志）这条核心链路**目前走不通**——报价、路由、交易三张表之间没有外键串联。

### 关键缺口 2：路由分析的数据不全

好消息：`route_candidates` 表**已落库**（route.service.ts 确实在 create），字段也够（net_output、route_score、estimated_gas）。

坏消息：

- **没有 `is_selected` 字段** → 无法判断「最终选了哪条路由」。
- **没有与 quote/swap 关联** → 无法算「选中的路由实际执行结果 vs 候选对比」（Route Gap / 报价竞争力无法算）。
- **没有 `route_compute_ms`** → 无法算路由计算耗时。
- **没有 gas 的 USD 换算、没有基准报价** → 需求 6.3「最优路由命中率」需要可复现基准，目前无。

### 关键缺口 3：业务问题 vs 技术问题的区分数据

现状 `swaps.status` 状态机**已经比较完整**（11 态，含 REVERTED/FAILED/DROPPED/REPLACED/EXPIRED），这是好基础。但：

- **失败原因没有结构化**：`swaps` 表没有 `failure_reason` 字段（revert 原因只在读回执时临时解析到 DTO，**没落库**）。
- 需求 12.4 的**统一错误码**（QUOTE_NOT_FOUND / RPC_TIMEOUT / INDEXER_LAG 等）**完全不存在**。
- **没有系统监控数据**：`system_metrics`、`error_events`、`anomaly_events` 表都不存在 → 无法区分「交易量下降是用户少了，还是 RPC 挂了 / 报价引擎挂了」。

### 关键缺口 4：无 USD 价格预言机

- 现有 `volume_usd` 只能靠「含 USDC 的交易取 USDC 侧」近似，非 USDC 对无法计价。
- 需求 3.1 要求「输入金额通过可靠价格源转 USD」，目前做不到。

### 关键缺口 5：无埋点 / 事件采集

- 前端零埋点（漏斗第一步「Swap Page View」都采不到）。
- 后端只有 NestJS Logger（分散的 `logger.warn`），**没有**统一的 `analytics_events` 事件采集。

---

## 三、可复用的部分（已有模块）

| 模块 | 复用价值 |
|---|---|
| Swap 状态机（11 态） | 高——需求 3.2 / 20.4 的状态区分已基本符合 |
| Indexer（断点续传 + 重组检测） | 高——链上事件采集已通 |
| route_candidates 落库 | 中——路由分析的地基已有，补关联即可 |
| 统一 API 信封 + 错误码映射（前端 services/swap.ts） | 高——admin 前端可直接复用这套模式 |
| AnalyticsDaily 幂等聚合 | 中——日度预聚合范式可扩展到小时级 |
| `swap-event.util.ts` 事件解析 | 高——事件→方向推导已通 |

---

## 四、需要新增的模块（按需求文档 Phase 1 优先级）

1. **事件采集层**：`analytics_events` + 前端埋点 + 后端事件 + `intent_id` 贯穿
2. **`intent_id` 关联体系**：quote / swap / route_candidates 三表加关联字段
3. **失败原因落库**：`swaps.failure_reason` + 统一错误码表
4. **系统监控**：`system_metrics` + `error_events`（API/RPC/Quote Engine/Route Engine/Indexer）
5. **漏斗表**：`analytics_funnel_events` / `analytics_intents`
6. **异常中心**：`anomaly_events` + `alert_rules` + `alert_notifications`
7. **独立 admin 前端**：`apps/admin`（与 DEX 分开、需登录、仅内部人员）

---

## 五、数据关联缺口（核心结论）

最核心的缺口是这一条：

```
当前：quotes ──(无关联)── route_candidates ──(无关联)── swaps ──(无关联)── swap_events
目标：intent_id 贯穿 前端行为 → 报价 → 路由 → 交易 → 链上回执 → 日志
```

**只要 `intent_id` 这条主线打通，「看到异常→找到指标→找到交易→找到日志→确认原因」才能成立。**
这是当前工程最大的结构性缺口，也是《需求文档》额外强调的第一关键设计。

---

## 六、额外强调的三个关键设计（现状 vs 目标）

| 关键设计 | 现状 | 目标 |
|---|---|---|
| 1. intent_id 全链路追踪 | 完全缺失（三表无关联） | intent_id 串联前端行为、报价、路由、签名、链上成交 |
| 2. 路由分析做深 | route_candidates 已落库，但缺 is_selected / 关联 / 耗时 / 基准 | 记录候选路径 + 实际选择 + Gas + 执行结果，可算 Route Gap |
| 3. 业务/技术问题区分 | 无失败原因落库、无系统监控表 | failure_reason + system_metrics + error_events，可逐层拆解 |
