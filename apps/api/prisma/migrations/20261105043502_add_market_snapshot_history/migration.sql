-- DropIndex
DROP INDEX "market_snapshots_chain_id_token_address_key";

-- CreateIndex
CREATE INDEX "market_snapshots_chain_id_token_address_created_at_idx" ON "market_snapshots"("chain_id", "token_address", "created_at");
