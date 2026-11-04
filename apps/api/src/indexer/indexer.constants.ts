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
