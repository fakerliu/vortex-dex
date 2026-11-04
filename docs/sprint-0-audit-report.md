# VORTEX DEX — Sprint 0 工程审计报告

> 版本：V1.0 · 日期：2026-11-05 · 审计人：顾全栈（技术负责人）
> 依据：《Product Requirements & Development Roadmap V1.0》PART 09 Sprint 0

## 一、审计结论（TL;DR）

VORTEX 当前**已经具备一个真实可运行的 DEX Aggregator 核心闭环**：真实报价引擎 → 真实路由引擎 → 真实链上交易执行 → 完整 Analytics 后台。但**距离 PRD 定义的完整产品还有明确缺口**。

**核心判断：Sprint 0 可以「有条件通过」，但必须先补齐 3 个硬缺口（合约层、测试层、数据真实度标记），才能进入 Sprint 1 的大规模功能开发。**

---

## 二、已有功能矩阵（真实实现，非 Mock）

| 模块 | 状态 | 证据（代码位置） |
|---|---|---|
| Token Registry | ✅ 真实 | `modules/token/`（Token 模块 + 链上读取 + seed） |
| Quote Engine | ✅ 真实 | `modules/quote/quote.service.ts`（createQuote/getQuote/resolveBestCandidate） |
| Route Engine | ✅ 真实 | `modules/route/route.service.ts`（computeRoute + 单跳/两跳/三跳路由 + Gas 折算） |
| DEX Adapters | ✅ 真实 | `dex/aerodrome`（classic + CL）+ `dex/uniswap-v3`（Base Sepolia） |
| Swap Execution | ✅ 真实 | `modules/swap/swap.service.ts`（prepare/submit + 回执 + revert 原因 + allowance/balance 检查） |
| Swap Reconciler | ✅ 真实 | `modules/swap/swap-reconciler.controller.ts`（reconcile/backfill） |
| Indexer | ✅ 真实 | `indexer/`（getLogs + 幂等 + 重组检测 reorg.ts + 断点续传） |
| Analytics 后台 | ✅ 真实 | `modules/analytics/`（Dashboard/DEX 分析/监控/异常/诊断/AI 共 10 步） |
| Admin 前端 | ✅ 真实 | `apps/admin/`（7 页：登录/仪表盘/DEX/监控/异常/诊断/AI） |
| 用户前端 | ✅ 真实 | `apps/web/`（swap/transactions/analytics） |

**协议地址均经过链上核验**（Aerodrome CL、Uniswap V3 Sepolia 等，见各适配器 constants）。

---

## 三、缺失功能矩阵（PRD 要求但未实现）

### P0（必须，PRD 明确 V1.0 包含）

| 模块 | PRD 要求 | 现状 | 缺口 |
|---|---|---|---|
| **Explore 市场发现** | MODULE 03 | ❌ 无 `market` 模块、无 `/explore` 页面 | 整个缺失 |
| **Token Detail** | MODULE 04 | ❌ 无 `/token/[chainId]/[address]` | 整个缺失 |
| **Portfolio 资产中心** | MODULE 05 | ❌ 无 `portfolio` 模块 | 整个缺失 |
| **Transactions 详情** | MODULE 06 | ⚠️ 有列表（`/transactions`），无详情页/事件查询 | 详情页缺失 |
| **Approval 授权管理** | MODULE 07 | ⚠️ 后端有 `readAllowance`（swap.service 内），无独立模块/页面 | 独立模块缺失 |
| **Token Security 安全中心** | MODULE 08 | ❌ 无 `security` 模块 | 整个缺失 |

### P1（后续版本，PRD 明示 V1.0 不含）

| 模块 | 现状 |
|---|---|
| Pool Explorer（MODULE 09） | ⚠️ 后端有 `pool` 模块（列表/详情），无前端页面 |
| Limit Order（MODULE 10） | ❌ 无（PRD 明示 V1.0 不含，属 P1） |
| DCA（MODULE 11） | ❌ 无 |
| Cross-chain（MODULE 12） | ❌ 无 |
| Alerts / Preferences（MODULE 14） | ❌ 无 |

---

## 四、硬缺口（Sprint 0 必须优先解决，否则阻断 Sprint 1）

### 缺口 1：合约层为空 🔴

`contracts/` 目录只有 `foundry.toml` + `.gitkeep` 占位，**0 个 `.sol` 文件**。

- PRD 定位是「DEX Aggregator」，理论上不自行做市（不需要 AMM 合约）；
- 但 `solidity-engineer`（寇链坚）之前的「Sprint 6 交易执行」采用的是**调用现有 DEX Router**（Aerodrome SwapRouter / Uniswap SwapRouter02），**未部署自有合约**。
- **判断**：对聚合器定位来说，这不一定是缺陷，但必须在报告中明确「当前无自有合约，交易执行复用官方 Router」这一事实，避免误以为有自定义执行器。

### 缺口 2：测试覆盖为零 🔴

全仓库 **0 个测试文件**（无 `.test.ts` / `.spec.ts` / `.t.sol`）。

- PRD PART 11 明确「不得在没有实际运行测试的情况下宣称测试通过」。
- 这与 PRD 的「生产级」目标直接冲突，是 Sprint 0 最严重的缺口。
- **必须补**：quote/route/swap 的后端单测（金额精度、路由排序、revert 分类）、路由引擎的核心路径测试。

### 缺口 3：数据真实度标记缺失 🟡

PRD PART 11 §24.3 要求所有数据来源区分 `REAL_ONCHAIN / REAL_PROVIDER / INTERNAL_CALCULATED / MOCK / UNAVAILABLE / STALE`。

当前代码**未做这套标记**，Explore/Token Detail 等尚未实现的市场数据将来若接入，必须从一开始就带上数据源标记。

---

## 五、PRD 与现状的架构一致性检查

| PRD 要求 | 现状 | 结论 |
|---|---|---|
| NestJS 模块化单体（不拆微服务） | ✅ 单 `apps/api`，模块化清晰 | 一致 |
| 不重复建 Analytics 体系 | ✅ 沿用一套 `analytics_*` | 一致 |
| intent_id 贯穿全链路 | ✅ 已有（Quote/Route/Swap/Event 均带 intent_id） | 一致 |
| 链上精度用原始整数 | ✅ Prisma `Decimal(78,0)`，字符串传递 | 一致 |
| UTC 存储 / ISO 8601 | ✅ | 一致 |
| 钱包签名在客户端 | ✅ 后端无任何私钥处理 | 一致 |
| 统一错误码 | ✅ 已覆盖（commit `cb071fe` 已补齐需求 12.4 的 12 个分类码，共 25 个 ErrorCodes） | 已闭环（本报告原「⚠️」为旧快照误判，已修正） |
| 统一响应信封 | ⚠️ 有 `{success,data}`，缺 `meta.requestId/timestamp` | 需补齐（Sprint 1 S1-3 已实施） |

---

## 六、依赖图与 Sprint 执行计划建议

### 关键依赖约束（PRD §21.2 映射）

```
Swap ← Token Registry + Quote + Route + Wallet + Transaction   （已通）
Explore ← Token Registry + Market Data                         （Market Data 缺失）
Token Detail ← Token Registry + Market Data + Pool + Risk      （缺）
Portfolio ← Wallet + Token Registry + Balance Provider + Price （缺）
Approval ← Wallet + Token Registry + RPC                       （缺独立模块）
```

### 建议 Sprint 顺序（对齐 PRD PART 09）

1. **Sprint 1（核心交易闭环完善）**：先补「测试层」（缺口2），把 Swap 的 quote 过期保护、Route Breakdown、失败错误分类、intent_id 贯穿做实，让核心链路「可验证」。
2. **Sprint 2（Token Registry + Market Data）**：Market Data Provider + Market Snapshot + 数据源标记（缺口3 在此落地）。
3. **Sprint 3（Explore + Token Detail）**：依赖 Sprint 2。
4. **Sprint 4（Portfolio + Transactions 详情）**：依赖钱包余额 + Indexer。
5. **Sprint 5（Approval + Security）**：依赖链上 allowance 读取。
6. **Sprint 6（Pool Explorer + 高级路由）**：Pool 数据 + 拆单。
7. **Sprint 7（Analytics 完整接入）**：大部分已做，补 Route/Protocol/Liquidity Analytics 与真实数据核对。

---

## 七、数据真实度核查（抽样）

| 数据 | 真实度 | 说明 |
|---|---|---|
| 报价 amountOut | REAL_ONCHAIN | 经 Aerodrome CL 池 / Uniswap V3 Quoter 实测 |
| 路由候选 | REAL_ONCHAIN | route_candidates 表，含 is_selected/route_compute_ms |
| 交易状态 | REAL_ONCHAIN | 以链上回执为准（tryReadReceipt） |
| Indexer 事件 | REAL_ONCHAIN | swap_events 幂等写入 + reorg 检测 |
| Dashboard 指标 | INTERNAL_CALCULATED | 聚合自真实库表，口径见 metrics-dictionary.md |
| Explore 榜单 | ❌ 未实现 | 无 Mock（因模块未建） |

---

## 八、审计报告附表

- **已有功能**：见第二部分（11 项真实实现）
- **缺失功能**：见第三部分（6 项 P0 缺口 + 5 项 P1）
- **重复模块**：无（Analytics 单一体系、Token Registry 单一数据源，符合「禁止重复建设」）
- **下一步任务清单**：见第六部分 Sprint 计划

---

> 本报告基于 `C:/Users/28564/WorkBuddy/VORTEX DEX` 真实代码结构产出，非 ZIP 上传、非推测。所有结论可复现核对。
