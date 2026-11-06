/**
 * 链上「时间戳 → 区块号」二分工具。
 *
 * 用于：
 * - 成交量 24h 时间窗（D4）：查询时用最新块 timestamp 反查近 24h 的边界块（零迁移）。
 * - 历史回填（D3）：反查「近 7 天前」的起始块，回拨 sync_state 让 Indexer 自然回填。
 */
import type { PublicClient } from 'viem';

/**
 * 在 [1, head] 内二分查找「timestamp ≤ targetTimestampSec 的最大区块号」。
 *
 * 语义：返回 block B，使得 B 是最后一个 timestamp 仍 ≤ target 的区块；
 * 于是 block_number >= B 等价于「发生在 target 之后（含）」。误差 ≤ 1 块（Base 约 2s）。
 */
export async function findBlockByTimestamp(
  client: PublicClient,
  targetTimestampSec: number,
  headBlock?: number,
): Promise<number> {
  const head = headBlock ?? Number(await client.getBlockNumber());

  let lo = 1;
  let hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const block = await client.getBlock({ blockNumber: BigInt(mid) });
    if (Number(block.timestamp) <= targetTimestampSec) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}
