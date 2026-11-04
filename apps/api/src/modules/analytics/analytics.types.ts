/**
 * 经营分析 Analytics DTO（Sprint 9）。
 *
 * 金额铁律：链上原始大整数一律字符串；禁 Float。
 * 关键约束：当前无 USD 价格预言机，volume 只给「原始 token 量 + 笔数」，
 * 不跨 token 求和、不伪造 USD；量（volume）与收入（revenue）严格分开。
 *
 * 统计来源可追踪：每个指标都声明 source（表.字段）并在响应 meta.definitions 里
 * 给出统一定义；summary 中的每个聚合都直接对应下面某条查询。
 */

/** 指标定义（响应 meta.definitions 原样返回，前端可直接渲染“口径说明”）。 */
export interface MetricDefinitionDto {
  /** 唯一键，与响应字段一一对应。 */
  key: string;
  /** 中文口径名。 */
  label: string;
  /** 一句话定义。 */
  definition: string;
  /** 来源表.字段。 */
  source: string;
}

/** 按输入 token 聚合的原始成交量（不跨 token 求和）。 */
export interface TokenVolumeDto {
  token: string;
  amountIn: string;
  amountOut: string;
  swaps: number;
}

/** 按 token 对聚合的原始成交量。 */
export interface PairVolumeDto {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  swaps: number;
}

/** 量（volume）：只反映交易量，不含任何收入口径。 */
export interface VolumeDto {
  /** 已确认平台交易笔数（swaps.status=CONFIRMED）。 */
  platformSwapCount: number;
  /** 参与平台交易的去重用户数（swaps.user_address distinct，全状态）。 */
  platformUniqueUsers: number;
  /** 链上原始 Swap 事件数（swap_events.event_type=Swap）。 */
  chainSwapEventCount: number;
  /** 链上原始 Swap 事件的去重 tx 数（swap_events.tx_hash distinct）。 */
  chainUniqueTxs: number;
  /** 平台已确认交易按输入 token 聚合（amount_in/amount_out 为原始大整数）。 */
  byToken: TokenVolumeDto[];
  /** 平台已确认交易按 token 对聚合。 */
  byPair: PairVolumeDto[];
}

/** 收入（revenue）：与 volume 严格分开。 */
export interface RevenueDto {
  /** 当前是否可计算。 */
  available: boolean;
  /** 收入口径定义。 */
  definition: string;
  /** 为什么不可用 / 或说明计算依据。 */
  note: string;
}

/** 平台经营（swaps + users 表）。 */
export interface PlatformDto {
  /** 平台交易总数（swaps 全状态）。 */
  totalSwaps: number;
  /** 已确认（链上成功）。 */
  confirmed: number;
  /** 待确认等非终态。 */
  pending: number;
  /** 失败 / 回滚。 */
  failed: number;
  /** 已注册用户数（users）。 */
  registeredUsers: number;
  /** 全状态明细（status -> 笔数）。 */
  statusBreakdown: Record<string, number>;
}

/** 链上（swap_events + pools + dex_protocols 表）。 */
export interface ChainDto {
  /** 事件类型明细（event_type -> 条数）。 */
  eventTypeBreakdown: Record<string, number>;
  /** 已索引流动性池数（pools）。 */
  indexedPools: number;
  /** 协议数（dex_protocols）。 */
  protocols: number;
  /** 链上事件是否只覆盖 Base Mainnet 的说明。 */
  note: string;
}

/** GET /api/v1/analytics/summary 返回。 */
export interface AnalyticsSummaryDto {
  generatedAt: string;
  /** null 表示全链汇总。 */
  chainId: number | null;
  volume: VolumeDto;
  revenue: RevenueDto;
  platform: PlatformDto;
  chain: ChainDto;
  definitions: MetricDefinitionDto[];
}

/** GET /api/v1/analytics/daily 单行。 */
export interface DailyRowDto {
  /** YYYY-MM-DD。 */
  date: string;
  chainId: number;
  /** 当日平台交易总数（全状态）。 */
  swapCount: number;
  /** 当日去重用户数。 */
  uniqueUsers: number;
  /** 当日已确认交易数（实时回退路径可算；预聚合表未单列此字段时为 null）。 */
  confirmedSwaps: number | null;
  /** 预聚合表里的 volume_usd（原始整数；无 USD 预言机时可能为 null）。 */
  volumeUsd: string | null;
  /** 预聚合表里的 platform_revenue_usd（可能为 null）。 */
  platformRevenueUsd: string | null;
  /** 该行数据来源：analytics_daily（预聚合）| swaps（实时回退）。 */
  source: 'analytics_daily' | 'swaps';
}

/** GET /api/v1/analytics/daily 返回。 */
export interface DailyResultDto {
  generatedAt: string;
  chainId: number | null;
  from: string | null;
  to: string | null;
  rows: DailyRowDto[];
  note: string;
}

/** GET /api/v1/analytics/protocol-distribution 单协议分布。 */
export interface ProtocolDistributionItemDto {
  protocolType: string;
  /** 该协议的链上 Swap 事件条数。 */
  swapEvents: number;
  /** 该协议的去重交易数（tx_hash distinct）。 */
  uniqueTxs: number;
}

/** GET /api/v1/analytics/protocol-distribution 返回。 */
export interface ProtocolDistributionResultDto {
  generatedAt: string;
  chainId: number | null;
  items: ProtocolDistributionItemDto[];
  note: string;
}

/** POST /api/v1/analytics/aggregate 返回（触发日聚合落库）。 */
export interface AggregateDailyResultDto {
  generatedAt: string;
  chainId: number | null;
  from: string | null;
  to: string | null;
  /** 聚合出的日期（YYYY-MM-DD）数。 */
  aggregatedDates: number;
  /** upsert 到 analytics_daily 的行数。 */
  upsertedRows: number;
  /** 扫描的 swaps 总数（全状态）。 */
  totalSwapsScanned: number;
  /** 其中 status=CONFIRMED 的笔数（计入 volume 的口径）。 */
  confirmedSwaps: number;
  /** 无法用 USDC 计价的已确认交易笔数（不计入 volume_usd）。 */
  unpricedSwaps: number;
  note: string;
}

/** 统一口径定义（self-documenting API）。 */
export const METRIC_DEFINITIONS: MetricDefinitionDto[] = [
  {
    key: 'volume.platformSwapCount',
    label: '平台已确认交易笔数',
    definition: 'swaps 表中 status=CONFIRMED 的记录数（链上成功后才计入成交量）。',
    source: 'swaps.status',
  },
  {
    key: 'volume.platformUniqueUsers',
    label: '平台去重用户数',
    definition: 'swaps 表中去重 user_address 的数量（全状态）。',
    source: 'swaps.user_address',
  },
  {
    key: 'volume.chainSwapEventCount',
    label: '链上 Swap 事件数',
    definition: 'swap_events 表中 event_type=Swap 的原始事件条数（Indexer 落库）。',
    source: 'swap_events.event_type',
  },
  {
    key: 'volume.chainUniqueTxs',
    label: '链上去重交易数',
    definition: 'swap_events 中 event_type=Swap 的去重 tx_hash 数量。',
    source: 'swap_events.tx_hash',
  },
  {
    key: 'volume.byToken',
    label: '按输入 token 成交量',
    definition:
      '平台已确认交易按 token_in 分组，SUM(amount_in) / SUM(amount_out)（原始大整数，不跨 token 求和）。',
    source: 'swaps.amount_in / swaps.amount_out',
  },
  {
    key: 'volume.byPair',
    label: '按 token 对成交量',
    definition:
      '平台已确认交易按 (token_in, token_out) 分组，SUM(amount_in) / SUM(amount_out)（原始大整数）。',
    source: 'swaps.amount_in / swaps.amount_out',
  },
  {
    key: 'revenue',
    label: '平台收入',
    definition:
      'VORTEX 协议向用户收取的额外手续费（区别于 DEX LP 手续费）。需在 swaps 落 fee / protocol_fee 字段并具备 USD 价格后计算。',
    source: '未建模（swaps 无 fee 字段）',
  },
  {
    key: 'platform.totalSwaps',
    label: '平台交易总数',
    definition: 'swaps 表全状态记录数。',
    source: 'swaps.id',
  },
  {
    key: 'platform.statusBreakdown',
    label: '状态明细',
    definition: 'swaps 按 status 分组的笔数。',
    source: 'swaps.status',
  },
  {
    key: 'platform.registeredUsers',
    label: '注册用户数',
    definition: 'users 表记录数（提交交易 / 注册时幂等 upsert）。',
    source: 'users.wallet_address',
  },
  {
    key: 'chain.eventTypeBreakdown',
    label: '链上事件类型明细',
    definition: 'swap_events 按 event_type 分组的条数（Swap/Sync/Mint/Burn/Fees/Collect）。',
    source: 'swap_events.event_type',
  },
  {
    key: 'chain.indexedPools',
    label: '已索引池子数',
    definition: 'pools 表记录数。',
    source: 'pools.id',
  },
  {
    key: 'chain.protocols',
    label: '协议数',
    definition: 'dex_protocols 表记录数。',
    source: 'dex_protocols.id',
  },
];
