/**
 * Indexer 常量（Sprint 7）。
 *
 * 事件 topic0 均为 `cast keccak` 计算 + Base Mainnet 实抓日志核验后的固定值，
 * 用于 getLogs 的 topics 过滤，避免把无关日志拉回来。
 */
import { BASE_MAINNET_CHAIN_ID } from '../chain/chain.constants';

/** Indexer 目前只索引 Base Mainnet 的 Aerodrome 池子。 */
export const INDEXER_CHAIN_ID = BASE_MAINNET_CHAIN_ID;

/**
 * 重组安全窗口（区块深度）。链上最近 depth 个区块可能被重组，暂不“确认”：
 * 每次扫描只推进到 head - REORG_SAFE_DEPTH；并保留最近 depth 个区块 hash，
 * 若后续发现 hash 不一致则回退重扫。Base 出块约 2s，12 块 ≈ 24s 已足够稳。
 */
export const REORG_SAFE_DEPTH = 12;

/** 单次 getLogs 的最大区块跨度（平衡 RPC 限流与吞吐）。 */
export const SCAN_CHUNK_BLOCKS = 200;

/**
 * 解析单次 getLogs 的实际区块跨度。
 * 不同 RPC 对 eth_getLogs 的单次区块范围限制不同：
 * - 公共 RPC（mainnet.base.org / publicnode）：约 200 块（默认值即可）。
 * - Alchemy 免费 tier：仅 10 块（超过返回 -32600，要求 block range ≤ 10）。
 * 故允许通过 INDEXER_CHUNK_BLOCKS 覆盖，适配付费/免费档不同限流。
 */
export function resolveChunkBlocks(): number {
  const raw = Number(process.env.INDEXER_CHUNK_BLOCKS);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 10000) {
    return raw;
  }
  return SCAN_CHUNK_BLOCKS;
}

/** 后台自动扫描循环间隔（毫秒）。 */
export const SCAN_INTERVAL_MS = 12_000;

/** RPC 请求最小间隔（毫秒），避免触发公共 RPC 限流。 */
export const MIN_RPC_INTERVAL_MS = 250;

/** 单次 getLogs 失败后的最大重试次数。 */
export const MAX_RPC_RETRIES = 6;

/** 单次批量落库的事件条数上限。 */
export const WRITE_BATCH_SIZE = 500;

/**
 * 备用 RPC 端点池（按序轮询；某端点限流/超时自动切换下一个）。
 * 实测 publicnode 对 getLogs 最宽松，放首位；mainnet.base.org 是官方端点但 getLogs
 * 限流较严，放第二位兜底。可通过 env INDEXER_RPC_URLS（逗号分隔）覆盖。
 */
export const DEFAULT_INDEXER_RPC_URLS = [
  'https://base-rpc.publicnode.com',
  'https://mainnet.base.org',
  'https://base.gateway.tenderly.co',
];

/** 可索引的经典池事件（Velodrome v2 fork）——topic0 -> 事件名。 */
export const CLASSIC_EVENT_TOPICS: Record<string, string> = {
  // Swap(address,address,uint256,uint256,uint256,uint256)
  '0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b': 'Swap',
  // Sync(uint256,uint256)
  '0xcf2aa50876cdfbb541206f89af0ee78d44a2abf8d328e37fa4917f982149848a': 'Sync',
  // Mint(address,uint256,uint256)
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f': 'Mint',
  // Burn(address,address,uint256,uint256)
  '0x5d624aa9c148153ab3446c1b154f660ee7701e549fe9b62dab7171b1c80e6fa2': 'Burn',
  // Fees(address,uint256,uint256)（Aerodrome/Velodrome v2 特有）
  '0x112c256902bf554b6ed882d2936687aaeb4225e8cd5b51303c90ca6cf43a8602': 'Fees',
};

/** 可索引的 CL 池事件（Slipstream / Uniswap v3 fork）——topic0 -> 事件名。 */
export const CL_EVENT_TOPICS: Record<string, string> = {
  // Swap(address,address,int256,int256,uint160,uint128,int24)
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': 'Swap',
  // Mint(address,address,int24,int24,uint128,uint256,uint256)
  '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde': 'Mint',
  // Burn(address,int24,int24,uint128,uint256,uint256)
  '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c': 'Burn',
  // Collect(address,address,int24,int24,uint128,uint128)
  '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0': 'Collect',
};

/** 所有可索引事件的 topic0 并集（getLogs topics 过滤用）。 */
export const ALL_INDEXED_TOPICS: string[] = [
  ...Object.keys(CLASSIC_EVENT_TOPICS),
  ...Object.keys(CL_EVENT_TOPICS),
];

/**
 * 单次 getLogs 的地址批大小（避免 33k+ 池地址一次塞进单个 eth_getLogs 打爆 RPC）。
 *
 * 注意：地址上限因 RPC 端点而异（已实测）：
 * - Alchemy（免费档）：支持 ≥500 个地址（本默认值针对 Alchemy 为主端点）。
 * - publicnode 免费档：单个 eth_getLogs 最多 10 个地址。
 * - mainnet.base.org 官方公共端点：eth_getLogs 限流极严，基本不可用。
 * 若把 publicnode 设为主端点，需通过 INDEXER_LOG_ADDRESS_BATCH=10 覆盖本值。
 */
const DEFAULT_LOG_ADDRESS_BATCH_SIZE = 500;

/** 解析单次 getLogs 的地址批大小（可用 INDEXER_LOG_ADDRESS_BATCH 覆盖）。 */
export function resolveLogAddressBatchSize(): number {
  const raw = Number(process.env.INDEXER_LOG_ADDRESS_BATCH);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 10000) {
    return raw;
  }
  return DEFAULT_LOG_ADDRESS_BATCH_SIZE;
}

/**
 * 是否只索引 Swap 事件（D7）。
 * 为 true 时 getLogs 只拉 classic Swap / CL Swap 两个 topic0，
 * 不再索引 Sync/Mint/Burn/Fees/Collect 等流动性事件。
 */
export function resolveIndexSwapOnly(): boolean {
  return process.env.INDEXER_INDEX_SWAP_ONLY === 'true';
}

/** 解析当前应使用的 getLogs topics 并集（D7：可切换为仅 Swap）。 */
export function resolveIndexedTopics(): string[] {
  if (resolveIndexSwapOnly()) {
    return [
      ...Object.entries(CLASSIC_EVENT_TOPICS)
        .filter(([, name]) => name === 'Swap')
        .map(([t]) => t),
      ...Object.entries(CL_EVENT_TOPICS)
        .filter(([, name]) => name === 'Swap')
        .map(([t]) => t),
    ];
  }
  return ALL_INDEXED_TOPICS;
}
