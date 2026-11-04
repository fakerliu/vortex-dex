/**
 * 数据真实度标记（PRD PART 11 §24.3）。
 *
 * 所有对外返回的市场数据字段都必须附加 `authenticity` 标记，用于向调用方
 * 声明该数据的真实程度与可信度，避免前端/下游把模拟数据、陈旧数据或
 * 不可用数据误当作实时链上真实数据来展示或用于交易决策。
 *
 * 约束：
 * - 新增市场数据接口（Explore / Token Detail 等）必须从一开始就带上
 *   `authenticity` 字段，不允许后续补丁式追加。
 * - 一个字段在同一响应中只能有一个 `authenticity` 值，取值严格限定为本枚举。
 */
export const DataAuthenticity = {
  /**
   * 直接来自链上合约读取 / RPC 回执。
   * 例如：`balanceOf`、`getReserves`、`slot0` 等链上合约调用结果，
   * 或交易回执中的 `status`、`logs`。可信度最高，无需第三方中转。
   */
  REAL_ONCHAIN: 'REAL_ONCHAIN',

  /**
   * 来自可信第三方数据源（Provider）。
   * 例如：CoinGecko / DefiLlama 等外部 API 返回的价格、TVL 等数据。
   * 数据真实但非本系统直接链上获取，需信任第三方供应商。
   */
  REAL_PROVIDER: 'REAL_PROVIDER',

  /**
   * 内部聚合 / 计算得出。
   * 例如：由多笔链上或 Provider 数据加权平均出的价格、基于池子数据推算
   * 的滑点、由路由引擎计算出的最优路径等。真实度低于原始来源，但仍是
   * 基于真实数据推导的结果。
   */
  INTERNAL_CALCULATED: 'INTERNAL_CALCULATED',

  /**
   * 模拟数据（Mock）。
   * 仅用于开发、演示、测试或降级兜底，不代表任何真实市场状态。
   * 生产环境出现该标记时前端必须显著提示用户「当前为模拟数据」。
   */
  MOCK: 'MOCK',

  /**
   * 数据不可用。
   * 上游数据源（链上 RPC / Provider / 内部计算）全部失败，无法给出该字段值。
   * 与该字段本身为空/缺失的语义不同：此标记主动声明「我们知道该字段，
   * 但当前无法取得真实值」。
   */
  UNAVAILABLE: 'UNAVAILABLE',

  /**
   * 过期 / 陈旧数据。
   * 曾真实存在但已超过时效阈值（如缓存过期、Indexer 落后、行情停止更新）。
   * 前端应结合 `updatedAt` / `staleAt` 等时间字段提示用户数据可能已过期。
   */
  STALE: 'STALE',
} as const;

export type DataAuthenticity = (typeof DataAuthenticity)[keyof typeof DataAuthenticity];
