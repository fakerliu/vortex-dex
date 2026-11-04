/**
 * 区块重组检测（Sprint 7）。
 *
 * 思路：Indexer 每扫完一段区块，就把「最近 N 个已同步区块」的 (区块号, hash) 持久化。
 * 下一轮扫描前，用当前链上真实的区块 hash 与持久化的 hash 逐一比对：
 * - 全部一致 → 未发生重组，继续向前扫。
 * - 某个区块号 N 处 hash 不一致 → 说明该区块及之后的所有区块被链重组替换了，
 *   需要回退到 N-1，删除 block_number >= N 的已索引事件，并从 N 重扫。
 *
 * 本模块只放纯函数，便于在 verify-indexer 中单测。
 */

export interface BlockHashRecord {
  n: number;
  hash: string;
}

/**
 * 从「存储的最近区块 hash」与「链上最新拉取的区块 hash」中定位重组点。
 * 返回 null 表示未检测到重组；否则返回发生重组的最早区块号（>= 该区块的事件需回退重扫）。
 *
 * 两个数组都按区块号升序排列；链上数组通常更长（覆盖到更晚的区块）。
 * 比较策略：把 fresh 建立 n -> hash 映射，从 stored 的最低区块开始往上比对，
 * 找到第一个（区块号最小）不一致（或链上已不存在）的位置——该区块即重组点，
 * 它以及它之后的所有区块都视为被链替换，需回退重扫。
 */
export function findReorgPoint(
  stored: BlockHashRecord[],
  fresh: BlockHashRecord[],
): number | null {
  const freshMap = new Map<number, string>();
  for (const r of fresh) {
    freshMap.set(r.n, r.hash.toLowerCase());
  }
  // 从最低区块往上找第一个不一致（或链上已不存在）的区块
  const ascending = [...stored].sort((a, b) => a.n - b.n);
  for (const rec of ascending) {
    const onchain = freshMap.get(rec.n);
    if (!onchain || onchain !== rec.hash.toLowerCase()) {
      return rec.n;
    }
  }
  return null;
}

/**
 * 序列化最近区块 hash 列表到 JSON 字符串（存 sync_state.recent_block_hashes）。
 */
export function serializeBlockHashes(records: BlockHashRecord[]): string {
  return JSON.stringify(records);
}

/**
 * 反序列化 sync_state.recent_block_hashes。
 */
export function parseBlockHashes(json: string): BlockHashRecord[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) {
      return [];
    }
    return arr
      .filter(
        (r): r is BlockHashRecord =>
          r &&
          typeof r.n === 'number' &&
          typeof r.hash === 'string' &&
          /^0x[0-9a-fA-F]{64}$/.test(r.hash),
      )
      .map((r) => ({ n: r.n, hash: r.hash.toLowerCase() }));
  } catch {
    return [];
  }
}
