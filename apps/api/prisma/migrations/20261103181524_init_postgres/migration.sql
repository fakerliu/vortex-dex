-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "logo_uri" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "risk" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dex_protocols" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol_type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "factory_address" TEXT,
    "router_address" TEXT,
    "quoter_address" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dex_protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "protocol_id" TEXT NOT NULL,
    "token0_address" TEXT NOT NULL,
    "token1_address" TEXT NOT NULL,
    "fee" DECIMAL(78,0) NOT NULL,
    "pool_address" TEXT NOT NULL,
    "liquidity" DECIMAL(78,0) NOT NULL,
    "reserve0" DECIMAL(78,0) NOT NULL,
    "reserve1" DECIMAL(78,0) NOT NULL,
    "last_synced_block" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" DECIMAL(78,0) NOT NULL,
    "amount_out" DECIMAL(78,0) NOT NULL,
    "gas_estimate" DECIMAL(78,0) NOT NULL,
    "price_impact" DECIMAL(78,0) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_candidates" (
    "id" TEXT NOT NULL,
    "path_id" TEXT NOT NULL,
    "token_path" TEXT NOT NULL,
    "pool_path" TEXT NOT NULL,
    "protocol_path" TEXT NOT NULL,
    "amount_in" DECIMAL(78,0) NOT NULL,
    "amount_out" DECIMAL(78,0) NOT NULL,
    "estimated_gas" DECIMAL(78,0) NOT NULL,
    "net_output" DECIMAL(78,0) NOT NULL,
    "price_impact" DECIMAL(78,0) NOT NULL,
    "route_score" DECIMAL(78,0) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swaps" (
    "id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" DECIMAL(78,0) NOT NULL,
    "amount_out" DECIMAL(78,0) NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "swaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap_events" (
    "id" TEXT NOT NULL,
    "swap_id" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "block_number" INTEGER NOT NULL,
    "log_index" INTEGER NOT NULL,
    "event_data" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swap_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_snapshots" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "block_number" INTEGER NOT NULL,
    "reserve0" DECIMAL(78,0) NOT NULL,
    "reserve1" DECIMAL(78,0) NOT NULL,
    "liquidity" DECIMAL(78,0) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "volume_usd" DECIMAL(78,0) NOT NULL,
    "swap_count" INTEGER NOT NULL,
    "unique_users" INTEGER NOT NULL,
    "platform_revenue_usd" DECIMAL(78,0) NOT NULL,
    "platform_cost_usd" DECIMAL(78,0) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE INDEX "tokens_chain_id_idx" ON "tokens"("chain_id");

-- CreateIndex
CREATE INDEX "tokens_symbol_idx" ON "tokens"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_chain_id_address_key" ON "tokens"("chain_id", "address");

-- CreateIndex
CREATE INDEX "dex_protocols_chain_id_idx" ON "dex_protocols"("chain_id");

-- CreateIndex
CREATE UNIQUE INDEX "dex_protocols_chain_id_name_version_key" ON "dex_protocols"("chain_id", "name", "version");

-- CreateIndex
CREATE INDEX "pools_protocol_id_idx" ON "pools"("protocol_id");

-- CreateIndex
CREATE INDEX "pools_chain_id_token0_address_token1_address_idx" ON "pools"("chain_id", "token0_address", "token1_address");

-- CreateIndex
CREATE UNIQUE INDEX "pools_chain_id_pool_address_key" ON "pools"("chain_id", "pool_address");

-- CreateIndex
CREATE INDEX "quotes_token_in_token_out_idx" ON "quotes"("token_in", "token_out");

-- CreateIndex
CREATE INDEX "quotes_created_at_idx" ON "quotes"("created_at");

-- CreateIndex
CREATE INDEX "route_candidates_path_id_idx" ON "route_candidates"("path_id");

-- CreateIndex
CREATE UNIQUE INDEX "swaps_tx_hash_key" ON "swaps"("tx_hash");

-- CreateIndex
CREATE INDEX "swaps_user_address_idx" ON "swaps"("user_address");

-- CreateIndex
CREATE INDEX "swaps_chain_id_idx" ON "swaps"("chain_id");

-- CreateIndex
CREATE INDEX "swaps_status_idx" ON "swaps"("status");

-- CreateIndex
CREATE INDEX "swap_events_swap_id_idx" ON "swap_events"("swap_id");

-- CreateIndex
CREATE UNIQUE INDEX "swap_events_tx_hash_log_index_key" ON "swap_events"("tx_hash", "log_index");

-- CreateIndex
CREATE INDEX "pool_snapshots_pool_id_idx" ON "pool_snapshots"("pool_id");

-- CreateIndex
CREATE UNIQUE INDEX "pool_snapshots_pool_id_block_number_key" ON "pool_snapshots"("pool_id", "block_number");

-- CreateIndex
CREATE INDEX "analytics_daily_date_idx" ON "analytics_daily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_daily_date_chain_id_key" ON "analytics_daily"("date", "chain_id");

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "dex_protocols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_events" ADD CONSTRAINT "swap_events_swap_id_fkey" FOREIGN KEY ("swap_id") REFERENCES "swaps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_snapshots" ADD CONSTRAINT "pool_snapshots_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
