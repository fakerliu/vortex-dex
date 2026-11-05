# VORTEX DEX 项目状态盘点（2026-11-06）

> 本文档是 V1.0~V1.3 + stable 专项完成后的「状态固化」快照，作为后续所有决策（尤其是 V1.4 架构决策）的起点。数据截至 2026-11-06 02:33。

## 一、项目定位与铁律

- **定位**：Base 链上的非托管 DEX Aggregator（聚合器），复用官方 Router，**无自有合约**。
- **铁律（当前仍成立）**：
  - 非托管：不接触私钥/助记词/已签名交易，只接收公开 `tx_hash`。
  - 复用官方 Router（Aerodrome classic / CL / Uniswap V3），`contracts/` 目录 0 个 `.sol`。
  - 金额一律 BigInt 定点，禁 Float；比率用十进制字符串。

## 二、技术栈与架构

- 后端：NestJS（模块化单体，非微服务）+ Prisma + PostgreSQL + Redis。
- 前端：Next.js + React + TypeScript + Tailwind + wagmi + viem + TanStack Query。
- 链上：Solidity（Foundry 已初始化但无合约）+ viem，Base Mainnet(8453) / Sepolia(84532)。
- 核心链路：Quote（报价）→ Route（路由）→ Swap（执行）→ Split（拆单）+ Market（链上推导价格）+ Indexer（事件索引）。

## 三、已完成功能清单（按版本）

| 版本 | 功能面 | 状态 |
|------|--------|------|
| V1.0 | 工程骨架、Token/Protocol/Pool、报价引擎、路由引擎、Swap 执行、Analytics、健康检查 | ✅ 已交付 |
| V1.1 | 交易详情 txHash 查、历史快照/涨跌幅、**拆单路由**（SplitOrder + N 子单，贪心+二分） | ✅ 已交付 |
| V1.2 | **价格提醒**（Alerts）、**用户偏好**（Preferences/favorites）、Token 选择器收藏区 | ✅ 已交付 + 走查 + 2 P1 修复 |
| V1.3 | **站内通知中心**（Notification + 推送抽象）、拆单性能（volatile 解析式免二分） | ✅ 已交付 + 端到端验收 |
| stable 专项 | **本地复刻 Solidly 曲线报价**（stable 池零 RPC 不 revert）+ 失衡池过滤 | ✅ 已交付（金标 8/8 一致） |

## 四、后端模块清单（apps/api/src/modules/）

alerts · analytics · approval · health · market · notifications · pool · preferences · protocol · quote · route · security · swap · token · user

前端页面（apps/web/src/app/）：swap / explore / token / portfolio / transactions / analytics / alerts / settings / approvals / pools / notifications

## 五、已知边界与未决事项

### 5.1 技术债 / 收尾项（便宜，可随时做）
1. **stable 池仍走 RPC 二分**：本地复刻已让报价不 revert，但 `binarySearchCap` 里 stable 池没有「本地免二分」分支（只有 volatile 有解析式），二分仍串行 RPC。可加本地纯函数二分（类似 `volatileAnalyticCap`）彻底消除。
2. **CL 池二分偏慢**：QuoterV2 不 revert 但仍是串行 RPC 二分，大额拆分时 CL 池部分耗时偏高。可做并行 probe 预热或缓存。

### 5.2 未决架构决策（V1.4 前置，最重要）
- **Limit Order / DCA / Cross-chain** 三项，都卡在「自有合约 vs 链下 keeper」这个架构级决策上。
- 现状矛盾：项目铁律是「无自有合约、复用官方 Router」，而这三项功能**天然需要**自定义执行逻辑（限价单在价格满足时成交、DCA 定时定投、跨链消息传递），官方 Router 无法原生支持。
- 决策未做之前，V1.4 无法立项开发。

### 5.3 其他未决
- 无（除上述外，V1.0~V1.3 均已闭环）。

## 六、关键 commit（近期）

```
82c51d5 docs(swap): 更正 stableSafeUpperBound 注释语义（A1 清理）
a796dde feat(dex): 本地复刻 Solidly stable 曲线报价 + 失衡池过滤（方案 A）
2552115 feat(swap): stable 池二分保守上界预判（方案 B 止血，后被 A 取代）
dfd96c3 perf(split): analytic cap for classic-volatile pools（volatile 解析式免二分）
1ed509d feat(v1.3): notifications center backend
456e263 feat(v1.3): notifications center frontend
```

## 七、下一步建议

1. ~~状态收口~~（本文档即为产出）
2. **V1.4 架构决策**：先梳理 Limit/DCA/跨链各自「自有合约 vs 链下 keeper」的取舍，由技术负责人拍板，再立项。
3. 可选：两个便宜的性能收尾（见 5.1）。
