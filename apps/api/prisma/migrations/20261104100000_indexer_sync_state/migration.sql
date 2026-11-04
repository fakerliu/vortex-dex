-- Sprint 7 Indexer：
-- 1. swap_events.swap_id 改为可空（Indexer 写入原始池子事件时尚未有用户交易记录，
--    Sprint 8 交易记录再回填关联）。
-- 2. 新增 sync_state 表，记录索引同步进度 + 最近区块 hash（断点续传 + 重组检测）。
-- 3. 为 swap_events.block_number 增加索引，加速按区块回退删除与历史查询。

ALTER TABLE "swap_events" ALTER COLUMN "swap_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sync_state" (
    "chain_id" INTEGER NOT NULL,
    "last_synced_block" INTEGER NOT NULL,
    "last_synced_hash" TEXT NOT NULL,
    "recent_block_hashes" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("chain_id")
);

CREATE INDEX "swap_events_block_number_idx" ON "swap_events"("block_number");
