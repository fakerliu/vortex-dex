-- CreateTable
CREATE TABLE "price_alerts" (
    "id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "target_price" DECIMAL(78,18) NOT NULL,
    "notify_method" TEXT NOT NULL DEFAULT 'in_app',
    "status" TEXT NOT NULL DEFAULT 'active',
    "triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "default_slippage_bps" INTEGER NOT NULL DEFAULT 50,
    "default_chain_id" INTEGER NOT NULL DEFAULT 8453,
    "default_deadline_sec" INTEGER NOT NULL DEFAULT 1200,
    "notify_alerts" BOOLEAN NOT NULL DEFAULT true,
    "favorite_tokens" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_alerts_user_address_idx" ON "price_alerts"("user_address");

-- CreateIndex
CREATE INDEX "price_alerts_chain_id_token_address_idx" ON "price_alerts"("chain_id", "token_address");

-- CreateIndex
CREATE INDEX "price_alerts_status_idx" ON "price_alerts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_address_key" ON "user_preferences"("user_address");
