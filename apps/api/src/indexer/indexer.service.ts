/**
 * 区块链 Indexer 核心服务（Sprint 7）。
 *
 * 数据流：RPC(getLogs) → 解析 ABI(decodeEventLog) → 数据标准化 → 幂等写 PG(swap_events)
 *         → 更新同步高度(sync_state)。
 *
 * 关键能力：
 * - 断点续传：sync_state.last_synced_block 记录已确认高度，重启后从此继续。
 * - 幂等：依赖 swap_events @@unique([tx_hash, log_index])，写入用 createMany skipDuplicates。
 * - 重组检测：保留最近 N 个区块 hash，下一轮与链上重新比对，不一致则回退重扫（reorg.ts）。
 * - 限流/重试/多端点：IndexerRpcClient。
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { decodeEventLog } from 'viem';
import { PrismaService } from '../prisma/prisma.service';
import { AERODROME_PROTOCOL_TYPE_CL } from '../dex/aerodrome/constants';
import {
  aerodromeClassicPoolEventAbi,
  aerodromeClPoolEventAbi,
} from '../dex/aerodrome/abis';
import {
  INDEXER_CHAIN_ID,
  REORG_SAFE_DEPTH,
  resolveChunkBlocks,
  resolveIndexedTopics,
  resolveLogAddressBatchSize,
  SCAN_INTERVAL_MS,
  WRITE_BATCH_SIZE,
} from './indexer.constants';
import { IndexerRpcClient } from './indexer-rpc.client';
import {
  findReorgPoint,
  parseBlockHashes,
  serializeBlockHashes,
} from './reorg';
import type {
  IndexerPool,
  IndexerStatus,
  NormalizedPoolEvent,
  ScanSummary,
} from './indexer.types';

const DEFAULT_INITIAL_LOOKBACK = 500;

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private readonly rpc: IndexerRpcClient;

  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private lastError: string | null = null;
  private lastScan: ScanSummary | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {
    this.rpc = new IndexerRpcClient(this.resolveRpcUrls());
  }

  // ---------- 生命周期 ----------

  onModuleInit(): void {
    if (process.env.INDEXER_AUTOSTART === 'true') {
      this.start();
    }
  }

  /** 启动后台扫描循环（INDEXER_AUTOSTART=true 时由 module 调用）。 */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.logger.log(
      `Indexer 后台循环启动（interval=${SCAN_INTERVAL_MS}ms, chain=${INDEXER_CHAIN_ID}）`,
    );
    void this.scanOnce();
    this.timer = setInterval(() => {
      void this.scanOnce();
    }, SCAN_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('Indexer 后台循环已停止');
  }

  onModuleDestroy(): void {
    this.stop();
  }

  // ---------- 核心：单轮扫描 ----------

  /**
   * 扫描一轮：从 last_synced_block+1 扫到 head - REORG_SAFE_DEPTH。
   * 可重复调用；已索引的事件会被幂等跳过。
   */
  async scanOnce(): Promise<ScanSummary> {
    if (this.scanning) {
      // 已有扫描在跑，直接返回当前状态对应的“空进度”，避免并发重复扫。
      return {
        chainId: INDEXER_CHAIN_ID,
        fromBlock: 0,
        toBlock: 0,
        scannedBlocks: 0,
        fetchedLogs: 0,
        indexedEvents: 0,
        writtenEvents: 0,
        skippedDuplicates: 0,
        headBlock: 0,
        lastSyncedBlock: 0,
        lag: 0,
        reorgDetected: false,
        durationMs: 0,
      };
    }

    this.scanning = true;
    const startedAt = Date.now();
    try {
      const pools = await this.loadPools();
      if (pools.length === 0) {
        throw new Error(`没有可索引的池子（chain=${INDEXER_CHAIN_ID}），先运行池子发现` );
      }

      const head = await this.rpc.getBlockNumber();
      const sync = await this.ensureSyncState(pools, head);

      // 1. 重组检测：比较持久化的最近区块 hash 与链上当前 hash
      let reorgDetected = false;
      let reorgRollbackFrom: number | undefined;
      const stored = parseBlockHashes(sync.recent_block_hashes);
      if (stored.length > 0) {
        const from = Math.min(...stored.map((r) => r.n));
        const to = Math.max(...stored.map((r) => r.n));
        const fresh = await this.rpc.getBlockHashes(from, to);
        const reorgPoint = findReorgPoint(stored, fresh);
        if (reorgPoint !== null) {
          reorgDetected = true;
          reorgRollbackFrom = reorgPoint;
          this.logger.warn(
            `检测到区块重组：回退 block >= ${reorgPoint} 的事件并重扫`,
          );
          await this.rollbackFrom(reorgPoint);
          sync.last_synced_block = reorgPoint - 1;
          sync.recent_block_hashes = '[]';
        }
      }

      const fromBlock = sync.last_synced_block + 1;
      const toBlock = Math.max(fromBlock - 1, head - REORG_SAFE_DEPTH);

      if (fromBlock > toBlock) {
        const summary = this.buildSummary(
          fromBlock,
          toBlock,
          0,
          0,
          0,
          0,
          0,
          head,
          sync.last_synced_block,
          reorgDetected,
          reorgRollbackFrom,
          startedAt,
        );
        this.lastScan = summary;
        return summary;
      }

      // 2. 分块拉日志 + 解析 + 标准化
      //    - 地址分批（每批 ≤ resolveLogAddressBatchSize()）：33k+ 池地址不能一次塞进
      //      单个 eth_getLogs（请求体超限 / RPC 拒绝），循环分批复用同一 topics。
      //    - D7：INDEXER_INDEX_SWAP_ONLY=true 时 topics 仅保留 Swap 的 topic0。
      const addressList = pools.map((p) => p.address);
      const poolByAddress = new Map(pools.map((p) => [p.address, p]));
      const events: NormalizedPoolEvent[] = [];
      let fetchedLogs = 0;

      const addressBatches: string[][] = [];
      const logAddressBatchSize = resolveLogAddressBatchSize();
      for (let i = 0; i < addressList.length; i += logAddressBatchSize) {
        addressBatches.push(addressList.slice(i, i + logAddressBatchSize));
      }

      const chunkBlocks = resolveChunkBlocks();
      const topics = resolveIndexedTopics();
      for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += chunkBlocks) {
        const chunkTo = Math.min(toBlock, chunkFrom + chunkBlocks - 1);
        for (const addresses of addressBatches) {
          const logs = await this.rpc.getLogs({
            fromBlock: chunkFrom,
            toBlock: chunkTo,
            addresses,
            topics,
          });
          fetchedLogs += logs.length;
          for (const log of logs) {
            const ev = this.decodeLog(log, poolByAddress);
            if (ev) {
              events.push(ev);
            }
          }
        }
      }

      // 3. 幂等写 PG
      const { written, skipped } = await this.writeEvents(events);

      // 4. 记录新的最近区块 hash（重组检测用）
      const windowFrom = Math.max(fromBlock, toBlock - REORG_SAFE_DEPTH + 1);
      const recentHashes = await this.rpc.getBlockHashes(windowFrom, toBlock);
      const lastHash = recentHashes.length
        ? recentHashes[recentHashes.length - 1].hash
        : sync.last_synced_hash;

      await this.prisma.syncState.upsert({
        where: { chain_id: INDEXER_CHAIN_ID },
        update: {
          last_synced_block: toBlock,
          last_synced_hash: lastHash,
          recent_block_hashes: serializeBlockHashes(recentHashes),
        },
        create: {
          chain_id: INDEXER_CHAIN_ID,
          last_synced_block: toBlock,
          last_synced_hash: lastHash,
          recent_block_hashes: serializeBlockHashes(recentHashes),
        },
      });

      const summary = this.buildSummary(
        fromBlock,
        toBlock,
        toBlock - fromBlock + 1,
        fetchedLogs,
        events.length,
        written,
        skipped,
        head,
        toBlock,
        reorgDetected,
        reorgRollbackFrom,
        startedAt,
      );
      this.lastScan = summary;
      this.lastError = null;
      return summary;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.logger.error(`Indexer 扫描失败: ${msg}`);
      throw err;
    } finally {
      this.scanning = false;
    }
  }

  // ---------- 同步状态监控 ----------

  async getStatus(): Promise<IndexerStatus> {
    let latestBlock = 0;
    try {
      latestBlock = await this.rpc.getBlockNumber();
    } catch {
      latestBlock = 0;
    }

    const sync = await this.prisma.syncState.findUnique({
      where: { chain_id: INDEXER_CHAIN_ID },
    });
    const totalEvents = await this.prisma.swapEvent.count({
      where: { block_number: { gte: 0 } },
    });
    const indexedPools = await this.prisma.pool.count({
      where: { chain_id: INDEXER_CHAIN_ID },
    });

    const lastSyncedBlock = sync?.last_synced_block ?? 0;
    return {
      chainId: INDEXER_CHAIN_ID,
      running: this.running,
      lastSyncedBlock,
      lastSyncedHash: sync?.last_synced_hash ?? '',
      latestBlock,
      lag: latestBlock > 0 ? Math.max(0, latestBlock - lastSyncedBlock) : 0,
      indexedPools,
      totalEvents,
      lastError: this.lastError,
      lastScan: this.lastScan,
    };
  }

  // ---------- 私有 ----------

  private resolveRpcUrls(): string[] {
    const raw = process.env.INDEXER_RPC_URLS;
    if (raw && raw.trim().length > 0) {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('http'));
    }
    return [];
  }

  private async loadPools(): Promise<IndexerPool[]> {
    const rows = await this.prisma.pool.findMany({
      where: { chain_id: INDEXER_CHAIN_ID },
      include: { protocol: true },
    });
    return rows.map((p) => ({
      id: p.id,
      address: p.pool_address,
      family:
        p.protocol.protocol_type === AERODROME_PROTOCOL_TYPE_CL
          ? 'cl'
          : 'classic',
      protocolType: p.protocol.protocol_type,
      token0: p.token0_address,
      token1: p.token1_address,
      lastSyncedBlock: p.last_synced_block,
    }));
  }

  private async ensureSyncState(
    pools: IndexerPool[],
    head: number,
  ): Promise<{
    last_synced_block: number;
    last_synced_hash: string;
    recent_block_hashes: string;
  }> {
    const existing = await this.prisma.syncState.findUnique({
      where: { chain_id: INDEXER_CHAIN_ID },
    });
    if (existing) {
      return {
        last_synced_block: existing.last_synced_block,
        last_synced_hash: existing.last_synced_hash,
        recent_block_hashes: existing.recent_block_hashes,
      };
    }

    const start = this.resolveStartBlock(pools, head);
    const created = await this.prisma.syncState.upsert({
      where: { chain_id: INDEXER_CHAIN_ID },
      update: {},
      create: {
        chain_id: INDEXER_CHAIN_ID,
        last_synced_block: start - 1,
        last_synced_hash: '',
        recent_block_hashes: '[]',
      },
    });
    this.logger.log(
      `初始化 sync_state：从区块 ${start} 开始索引（head=${head}）`,
    );
    return {
      last_synced_block: created.last_synced_block,
      last_synced_hash: created.last_synced_hash,
      recent_block_hashes: created.recent_block_hashes,
    };
  }

  private resolveStartBlock(pools: IndexerPool[], head: number): number {
    const envStart = Number(process.env.INDEXER_START_BLOCK);
    if (Number.isInteger(envStart) && envStart > 0) {
      return envStart;
    }
    const minSynced = Math.min(...pools.map((p) => p.lastSyncedBlock ?? 0));
    if (minSynced > 0) {
      return minSynced;
    }
    return Math.max(1, head - DEFAULT_INITIAL_LOOKBACK);
  }

  private decodeLog(
    log: {
      address: string;
      topics: string[];
      data: string;
      blockNumber: bigint;
      blockHash: string;
      transactionHash: string;
      logIndex: number;
    },
    poolByAddress: Map<string, IndexerPool>,
  ): NormalizedPoolEvent | null {
    const pool = poolByAddress.get(log.address);
    if (!pool) {
      return null;
    }
    const abi =
      pool.family === 'cl'
        ? aerodromeClPoolEventAbi
        : aerodromeClassicPoolEventAbi;

    let decoded: { eventName: string; args: Record<string, unknown> };
    try {
      decoded = decodeEventLog({
        abi: abi as never,
        data: log.data as `0x${string}`,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      }) as unknown as { eventName: string; args: Record<string, unknown> };
    } catch (err) {
      this.logger.warn(
        `日志解析失败（pool=${log.address} tx=${log.transactionHash} logIndex=${log.logIndex}）: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    return {
      chainId: INDEXER_CHAIN_ID,
      poolId: pool.id,
      poolAddress: pool.address,
      family: pool.family,
      protocolType: pool.protocolType,
      txHash: log.transactionHash.toLowerCase(),
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      blockHash: log.blockHash.toLowerCase(),
      eventType: decoded.eventName,
      args: this.sanitizeArgs(decoded.args),
    };
  }

  /** 把 bigint 转字符串、地址统一小写，确保 JSON 可序列化且地址规范化。 */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'bigint') {
        out[key] = value.toString();
      } else if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) {
        out[key] = value.toLowerCase();
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  private async writeEvents(
    events: NormalizedPoolEvent[],
  ): Promise<{ written: number; skipped: number }> {
    if (events.length === 0) {
      return { written: 0, skipped: 0 };
    }

    let written = 0;
    let skipped = 0;
    for (let i = 0; i < events.length; i += WRITE_BATCH_SIZE) {
      const batch = events.slice(i, i + WRITE_BATCH_SIZE);
      const data = batch.map((e) => ({
        tx_hash: e.txHash,
        event_type: e.eventType,
        block_number: e.blockNumber,
        log_index: e.logIndex,
        event_data: JSON.stringify({
          pool: e.poolAddress,
          poolId: e.poolId,
          family: e.family,
          protocolType: e.protocolType,
          blockHash: e.blockHash,
          ...e.args,
        }),
      }));
      const res = await this.prisma.swapEvent.createMany({
        data,
        skipDuplicates: true,
      });
      written += res.count;
      skipped += batch.length - res.count;
    }
    return { written, skipped };
  }

  /** 重组回退：删除 block_number >= from 的已索引事件。 */
  private async rollbackFrom(fromBlock: number): Promise<void> {
    const deleted = await this.prisma.swapEvent.deleteMany({
      where: { block_number: { gte: fromBlock } },
    });
    this.logger.warn(`重组回退：删除 ${deleted.count} 条 block_number >= ${fromBlock} 的事件`);
  }

  private buildSummary(
    fromBlock: number,
    toBlock: number,
    scannedBlocks: number,
    fetchedLogs: number,
    indexedEvents: number,
    writtenEvents: number,
    skippedDuplicates: number,
    headBlock: number,
    lastSyncedBlock: number,
    reorgDetected: boolean,
    reorgRollbackFrom: number | undefined,
    startedAt: number,
  ): ScanSummary {
    return {
      chainId: INDEXER_CHAIN_ID,
      fromBlock,
      toBlock,
      scannedBlocks,
      fetchedLogs,
      indexedEvents,
      writtenEvents,
      skippedDuplicates,
      headBlock,
      lastSyncedBlock,
      lag: Math.max(0, headBlock - lastSyncedBlock),
      reorgDetected,
      reorgRollbackFrom,
      durationMs: Date.now() - startedAt,
    };
  }
}
