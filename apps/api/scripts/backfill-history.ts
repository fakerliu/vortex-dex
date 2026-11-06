/**
 * 近 7 天历史回填脚本（D3）。
 *
 * 运行：pnpm --filter @vortex/api exec tsx scripts/backfill-history.ts
 *
 * 原理：把 sync_state.last_synced_block 回拨到「7 天前的区块 - 1」，
 *       并清空 recent_block_hashes，让 Indexer 下次 scanOnce 从 7 天前开始
 *       自然回填（增量幂等，已索引事件会被 skipDuplicates 跳过）。
 *
 * 回填窗口可用 DAYS 环境变量覆盖（默认 7）。
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createPublicClient, http, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { INDEXER_CHAIN_ID } from '../src/indexer/indexer.constants';
import { findBlockByTimestamp } from '../src/chain/block-time';

const DAYS = Number(process.env.BACKFILL_DAYS ?? 7);
const WINDOW_SEC = DAYS * 24 * 60 * 60;

function resolveRpcUrl(): string {
  if (process.env.BASE_MAINNET_RPC_URL) {
    return process.env.BASE_MAINNET_RPC_URL;
  }
  const first = (process.env.INDEXER_RPC_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.startsWith('http'));
  return first ?? 'https://mainnet.base.org';
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const client = createPublicClient({
    chain: base,
    transport: http(resolveRpcUrl(), { timeout: 20_000, retryCount: 1 }),
  }) as PublicClient;

  try {
    const head = Number(await client.getBlockNumber());
    const headBlock = await client.getBlock({ blockNumber: BigInt(head) });
    const headTs = Number(headBlock.timestamp);
    const targetTs = headTs - WINDOW_SEC;

    const boundary = await findBlockByTimestamp(client, targetTs, head);
    const resumeFrom = Math.max(1, boundary - 1);

    console.log(
      `最新块=${head}（ts=${headTs}，${new Date(headTs * 1000).toISOString()}）`,
    );
    console.log(
      `回填 ${DAYS} 天 → 目标时间 ${new Date(targetTs * 1000).toISOString()} → 边界块=${boundary}`,
    );

    const sync = await prisma.syncState.upsert({
      where: { chain_id: INDEXER_CHAIN_ID },
      update: {
        last_synced_block: resumeFrom,
        last_synced_hash: '',
        recent_block_hashes: '[]',
      },
      create: {
        chain_id: INDEXER_CHAIN_ID,
        last_synced_block: resumeFrom,
        last_synced_hash: '',
        recent_block_hashes: '[]',
      },
    });

    console.log(
      `sync_state 已回拨：last_synced_block=${sync.last_synced_block}（下次 Indexer 扫描从此 +1 开始）`,
    );
    console.log(
      '提示：若 API 已以 INDEXER_AUTOSTART=true 运行，Indexer 会在下一轮 scanOnce 自动回填。',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log('BACKFILL-HISTORY DONE');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nBACKFILL-HISTORY FAILED');
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
