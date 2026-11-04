/**
 * Indexer 专用 RPC 客户端（Sprint 7）。
 *
 * 与 ChainRpcService 的区别：Indexer 需要
 * 1. 多端点轮询 + 故障切换（公共 Base RPC 有严格限流，单端点会被打满）；
 * 2. 请求节流（最小间隔），避免触发 -32011 "request limit reached"；
 * 3. 指数退避重试，RPC 断开/超时自动重试并切换端点。
 *
 * 只做「读日志/读区块」，不涉及交易、不碰私钥。
 */
import {
  createPublicClient,
  http,
  type Chain,
  type PublicClient,
} from 'viem';
import { base } from 'viem/chains';
import {
  DEFAULT_INDEXER_RPC_URLS,
  MAX_RPC_RETRIES,
  MIN_RPC_INTERVAL_MS,
} from './indexer.constants';
import type { BlockHashRecord } from './reorg';
import type { RawLog } from './indexer.types';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class IndexerRpcClient {
  private readonly clients: PublicClient[];
  private cursor = 0;
  private lastRequestAt = 0;

  constructor(urls: string[] = DEFAULT_INDEXER_RPC_URLS) {
    const resolved = urls.length > 0 ? urls : DEFAULT_INDEXER_RPC_URLS;
    // 显式标注为泛型 Chain，避免 base 自身的 formatter 类型泄漏到返回值，
    // 导致与 PublicClient 默认类型不兼容（与 ChainRpcService 同款处理）。
    const chain: Chain = base;
    this.clients = resolved.map((url) =>
      createPublicClient({
        chain,
        transport: http(url, { timeout: 15_000, retryCount: 0 }),
        batch: { multicall: false },
      }),
    );
  }

  get endpointCount(): number {
    return this.clients.length;
  }

  /** 读链上最新区块号。 */
  async getBlockNumber(): Promise<number> {
    return this.request((c) => c.getBlockNumber()).then((n) => Number(n));
  }

  /** 读指定区块的 hash。 */
  async getBlockHash(blockNumber: number): Promise<string> {
    return this.request(async (c) => {
      const block = await c.getBlock({ blockNumber: BigInt(blockNumber) });
      return block.hash as string;
    });
  }

  /** 读一个区块区间内每个区块的 hash（重组检测用）。 */
  async getBlockHashes(from: number, to: number): Promise<BlockHashRecord[]> {
    const out: BlockHashRecord[] = [];
    for (let n = from; n <= to; n++) {
      const hash = await this.getBlockHash(n);
      out.push({ n, hash: hash.toLowerCase() });
    }
    return out;
  }

  /**
   * 按区块区间 + 地址 + topics 拉日志（带节流/重试/端点切换）。
   * 已移除 removed=true 的日志（reorg 后残留日志，不应入索引）。
   */
  async getLogs(params: {
    fromBlock: number;
    toBlock: number;
    addresses: string[];
    topics?: string[];
  }): Promise<RawLog[]> {
    const { fromBlock, toBlock, addresses, topics } = params;
    // 注意：viem 的 client.getLogs 只支持 event/events（内部编码 topics），
    // 不暴露 raw topics 参数。这里改用 client.request 直连 eth_getLogs，
    // 精确控制 topics（位置 0 传数组 = OR 语义），并自行解析 hex 字段。
    const raw = await this.request((c) =>
      c.request({
        method: 'eth_getLogs',
        params: [
          {
            address: addresses as `0x${string}`[],
            topics: (topics && topics.length > 0 ? [topics] : []) as `0x${string}`[][],
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
          },
        ],
      }),
    );

    const logs = raw as unknown as Array<{
      address: string;
      topics: string[];
      data: string;
      blockNumber: string | null;
      blockHash: string | null;
      transactionHash: string | null;
      logIndex: string | null;
      removed?: boolean;
    }>;

    return logs
      .filter((l) => !l.removed)
      .map((l) => ({
        address: l.address.toLowerCase(),
        topics: [...l.topics],
        data: l.data,
        blockNumber: BigInt(l.blockNumber ?? '0x0'),
        blockHash: l.blockHash ?? '',
        transactionHash: l.transactionHash ?? '',
        logIndex: l.logIndex ? parseInt(l.logIndex, 16) : 0,
        removed: l.removed ?? false,
      }));
  }

  // ---------- 私有 ----------

  /** 请求入口：节流 + 轮询端点 + 指数退避重试。 */
  private async request<T>(fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    const totalAttempts = MAX_RPC_RETRIES * this.clients.length;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      await this.throttle();
      const client = this.clients[this.cursor % this.clients.length];
      this.cursor += 1;

      try {
        return await fn(client);
      } catch (err) {
        lastErr = err;
        // 指数退避（封顶 8s）
        const backoff = Math.min(8000, 500 * 2 ** Math.min(attempt, 4));
        await sleep(backoff);
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Indexer RPC 请求失败: ${String(lastErr)}`);
  }

  /** 节流：保证两次请求之间至少间隔 MIN_RPC_INTERVAL_MS。 */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < MIN_RPC_INTERVAL_MS) {
      await sleep(MIN_RPC_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}
