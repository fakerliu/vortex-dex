-- CreateTable
CREATE TABLE "market_snapshots" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_address" TEXT NOT NULL,
    "price_usd" DECIMAL(78,18),
    "quote_token" TEXT,
    "liquidity_usd" DECIMAL(78,0),
    "authenticity" TEXT NOT NULL,
    "source" TEXT,
    "block_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_snapshots_created_at_idx" ON "market_snapshots"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "market_snapshots_chain_id_token_address_key" ON "market_snapshots"("chain_id", "token_address");
