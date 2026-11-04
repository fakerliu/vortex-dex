/**
 * Indexer 类型定义（Sprint 7）。
 */

/** 池子协议族（决定用哪套事件 ABI 解析）。 */
export type PoolFamily = 'classic' | 'cl';

/** 索引时用到的池子元信息（从 pools 表读出的最小集）。 */
export interface IndexerPool {
  id: string; // pools.id
  address: string; // 小写
  family: PoolFamily;
  protocolType: string; // aerodrome_classic | aerodrome_cl
  token0: string;
  token1: string;
  lastSyncedBlock: number; // pools.last_synced_block
}

/** 解析后的标准化事件（落库前）。 */
export interface NormalizedPoolEvent {
  chainId: number;
  poolId: string; // pools.id
  poolAddress: string; // 小写
  family: PoolFamily;
  protocolType: string;
  txHash: string; // 小写
  blockNumber: number;
  logIndex: number;
  blockHash: string;
  eventType: string; // Swap / Sync / Mint / Burn / Fees / Collect
  /** 解析后的事件参数（bigint 已转字符串），将连同 pool 元信息一起存入 event_data。 */
  args: Record<string, unknown>;
}

/** 一次扫描的进度摘要（同步状态监控用）。 */
export interface ScanSummary {
  chainId: number;
  fromBlock: number;
  toBlock: number;
  scannedBlocks: number;
  fetchedLogs: number;
  indexedEvents: number;
  writtenEvents: number; // 本次新写入（去重后）
  skippedDuplicates: number; // 幂等跳过的重复事件
  headBlock: number;
  lastSyncedBlock: number;
  lag: number;
  reorgDetected: boolean;
  reorgRollbackFrom?: number;
  durationMs: number;
}

/** 同步状态监控视图。 */
export interface IndexerStatus {
  chainId: number;
  running: boolean;
  lastSyncedBlock: number;
  lastSyncedHash: string;
  latestBlock: number;
  lag: number;
  indexedPools: number;
  totalEvents: number;
  lastError: string | null;
  lastScan: ScanSummary | null;
}

/** getLogs 拉回的原始日志（viem Log）。 */
export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  removed?: boolean;
}
