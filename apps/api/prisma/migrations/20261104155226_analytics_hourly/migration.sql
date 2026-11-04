-- CreateTable
CREATE TABLE "analytics_hourly" (
    "id" TEXT NOT NULL,
    "hour" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "swap_count" INTEGER NOT NULL DEFAULT 0,
    "confirmed_swaps" INTEGER NOT NULL DEFAULT 0,
    "failed_swaps" INTEGER NOT NULL DEFAULT 0,
    "unique_users" INTEGER NOT NULL DEFAULT 0,
    "quote_count" INTEGER NOT NULL DEFAULT 0,
    "volume_usd" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_hourly_hour_idx" ON "analytics_hourly"("hour");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_hourly_hour_chain_id_key" ON "analytics_hourly"("hour", "chain_id");
