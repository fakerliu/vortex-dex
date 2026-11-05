-- CreateTable
CREATE TABLE "limit_orders" (
    "id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'buy',
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" DECIMAL(78,0) NOT NULL,
    "min_amount_out" DECIMAL(78,0) NOT NULL,
    "limit_price" DECIMAL(78,18) NOT NULL,
    "slippage_bps" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "triggered_at" TIMESTAMP(3),
    "filled_at" TIMESTAMP(3),
    "swap_id" TEXT,
    "tx_hash" TEXT,
    "failure_reason" TEXT,
    "signed_swap_tx" TEXT,
    "signed_approval_tx" TEXT,
    "settlement_contract" TEXT,
    "order_nonce" INTEGER,
    "eip712_signature" TEXT,
    "fill_kind" TEXT NOT NULL DEFAULT 'fill_or_kill',

    CONSTRAINT "limit_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "limit_orders_user_address_created_at_idx" ON "limit_orders"("user_address", "created_at");

-- CreateIndex
CREATE INDEX "limit_orders_status_expires_at_idx" ON "limit_orders"("status", "expires_at");

-- CreateIndex
CREATE INDEX "limit_orders_chain_id_token_in_token_out_status_idx" ON "limit_orders"("chain_id", "token_in", "token_out", "status");
