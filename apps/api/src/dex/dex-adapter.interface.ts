import type {
  GasEstimate,
  Pool,
  PoolState,
  ProtocolInfo,
  QuoteParams,
  QuoteResult,
} from './types';

/**
 * 统一 DEX 协议 Adapter 接口（Sprint 3）。
 *
 * 所有实现必须遵守：
 * - 地址一律来自官方文档/部署清单，并经链上 RPC 核验，禁止编造。
 * - V2（恒定乘积）与 V3/CL（集中流动性）逻辑严格区分，禁止用 V2 公式冒充 V3。
 * - 金额一律 BigInt / 十进制字符串，禁止 Float。
 * - RPC 失败统一抛 ChainReadError，由上层翻译为 503 / RPC_UNAVAILABLE。
 */
export interface DexAdapter {
  getProtocolInfo(): Promise<ProtocolInfo>;
  discoverPools(tokenA: string, tokenB: string): Promise<Pool[]>;
  getPoolState(poolAddress: string): Promise<PoolState>;
  getQuote(params: QuoteParams): Promise<QuoteResult>;
  estimateGas(params: QuoteParams): Promise<GasEstimate>;
}

/** Adapter 构造时的最小约束标记，便于未来扩展多协议时统一注入。 */
export const DEX_ADAPTER = Symbol('DEX_ADAPTER');
