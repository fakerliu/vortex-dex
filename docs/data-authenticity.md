# 数据真实度标记（Data Authenticity）

> 依据 PRD PART 11 §24.3。定义 VORTEX DEX 所有对外返回数据的「真实度」标记约定。

## 1. 背景与目标

VORTEX DEX 的数据来源多样：链上合约直接读取、可信第三方 Provider、内部聚合计算、
以及开发/演示用的模拟数据。如果响应里不区分这些来源，前端与下游无法判断
「这个价格是实时链上的，还是缓存的，还是 mock 的」，可能在真实交易场景中误用。

因此，所有**市场数据类接口**返回的字段都必须附加 `authenticity` 标记，
声明该字段值的真实程度。标记是一个字符串枚举，取值严格限定为以下 6 种。

## 2. 枚举定义

类型定义文件：`apps/api/src/common/constants/data-authenticity.ts`

| 枚举值 | 含义 | 典型来源 |
| --- | --- | --- |
| `REAL_ONCHAIN` | 直接来自链上合约读取 / RPC 回执 | `balanceOf`、`getReserves`、`slot0`、交易回执 `status`/`logs` |
| `REAL_PROVIDER` | 来自可信第三方数据源 | CoinGecko / DefiLlama 等外部 API 返回的价格、TVL |
| `INTERNAL_CALCULATED` | 内部聚合 / 计算得出 | 多源加权均价、路由引擎算出的滑点/最优路径 |
| `MOCK` | 模拟数据 | 开发、演示、测试、降级兜底 |
| `UNAVAILABLE` | 数据不可用 | 上游（链上/Provider/内部计算）全部失败，主动声明「取不到」 |
| `STALE` | 过期 / 陈旧数据 | 缓存过期、Indexer 落后、行情停止更新 |

真实度从高到低（可信度排序）：

```
REAL_ONCHAIN  >  REAL_PROVIDER  >  INTERNAL_CALCULATED  >  STALE  >  MOCK / UNAVAILABLE
```

> `STALE` 本身不是「低质量」而是「过期」：它可能曾经是 `REAL_ONCHAIN`，
> 只是超过了时效阈值。`MOCK` 与 `UNAVAILABLE` 是两种不同的「不可信」：
> 前者是主动伪造，后者是客观缺失。

## 3. 适用场景

### 3.1 每个枚举值该用在哪

- **`REAL_ONCHAIN`**：字段值直接来自链上调用返回，且未经任何二次加工。
  - 示例：`balanceOf` 返回的用户余额、`getReserves` 返回的池子储备量、交易回执中的 `status`。
- **`REAL_PROVIDER`**：字段值来自可信外部数据供应商的 API。
  - 示例：第三方行情源返回的代币法币价格、DefiLlama 的 TVL。
- **`INTERNAL_CALCULATED`**：字段值由本系统基于真实数据推导。
  - 示例：多池加权均价、由路由引擎计算的最优兑换路径与预计滑点、Gas 估算。
- **`MOCK`**：仅限开发/演示/测试环境，或明确标注的降级 mock。生产环境出现时必须
  由前端显著提示用户「当前为模拟数据」。
- **`UNAVAILABLE`**：该字段本应有值，但当前上游全部失败。
  与「字段缺失/为 null」语义不同——它是主动声明「我们知道有这个字段，但取不到」。
- **`STALE`**：该字段曾经真实，但已超过时效阈值。前端应结合时间字段
  （`updatedAt` / `staleAt`）提示数据可能过期。

### 3.2 字段粒度

`authenticity` 是**字段级**标记，不是接口级。同一响应内不同字段可有不同取值：

```jsonc
{
  "priceUsd": 3.14,            // 来源 Provider
  "priceAuthenticity": "REAL_PROVIDER",
  "reserve0": "1000000000000", // 来源链上
  "reserve0Authenticity": "REAL_ONCHAIN",
  "slippageBps": 30,           // 内部计算
  "slippageAuthenticity": "INTERNAL_CALCULATED"
}
```

推荐两种字段命名方式（二选一，团队内保持一致）：

1. **并置字段**：`{field}Authenticity`，如上例。
2. **内嵌对象**：把值与标记包成一个对象 `{ value, authenticity }`。

> 建议新接口优先采用方式 1（并置字段），改动面小、对现有消费方透明。

## 4. 必须附加 authenticity 的接口 / 字段

以下为「硬约束」清单：

### 4.1 硬约束：新增市场数据接口

> **新增市场数据接口（Explore / Token Detail 等）必须从一开始就带上
> `authenticity` 字段，不允许先上线再补标记。**

- **Explore**（行情浏览 / 代币列表）：每个代币的 `priceUsd`、`volume24h`、
  `liquidity` 等市场字段。
- **Token Detail**（代币详情，对应现有 `GET /tokens/:address`）：价格、流动性、
  持有量等市场字段。

### 4.2 存量接口的字段映射（参考）

| 接口 | 字段 | 建议标记 |
| --- | --- | --- |
| `GET /tokens/:address/balance` | `balance` | `REAL_ONCHAIN` |
| `GET /quote` | `priceImpact` / `slippage` / `amountOut` | `INTERNAL_CALCULATED` |
| `GET /route` | 路由路径、`ethToTokenRate` | `INTERNAL_CALCULATED` |
| `GET /swaps/:id` | 交易状态 | `REAL_ONCHAIN`（来自回执） |

> 上表为「参考建议」，不要求在本任务中改动任何存量业务代码。存量接口的
> 标记改造在后续 Sprint 单独排期。

## 5. 约定与禁忌

1. 取值**只允许**本枚举的 6 个值之一，不得使用其他字符串。
2. 同一字段在同一响应中**只能有一个** `authenticity` 值。
3. 前端/下游在展示或用于交易决策前，应优先检查标记：
   - `MOCK` → 显著提示「模拟数据」。
   - `STALE` → 提示「数据可能过期」并展示时间字段。
   - `UNAVAILABLE` → 字段置灰 / 显示「暂无数据」。
4. 生产环境的行情/报价链路，**禁止**以 `MOCK` 静默代替真实数据；确需降级时，
   必须将 `authenticity` 置为 `MOCK` 并让前端可见。
5. 新增枚举值须经评审，并同步更新本文件与类型定义。
