-- CreateTable
CREATE TABLE "split_orders" (
    "id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" DECIMAL(78,0) NOT NULL,
    "status" TEXT NOT NULL,
    "child_count" INTEGER NOT NULL,
    "intent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "split_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "split_children" (
    "id" TEXT NOT NULL,
    "split_order_id" TEXT NOT NULL,
    "swap_id" TEXT,
    "pool_address" TEXT NOT NULL,
    "protocol_type" TEXT NOT NULL,
    "amount_in" DECIMAL(78,0) NOT NULL,
    "amount_out" DECIMAL(78,0) NOT NULL,
    "price_impact" DECIMAL(78,18),
    "order_index" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "split_children_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "split_orders_user_address_idx" ON "split_orders"("user_address");

-- CreateIndex
CREATE INDEX "split_orders_intent_id_idx" ON "split_orders"("intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "split_children_swap_id_key" ON "split_children"("swap_id");

-- CreateIndex
CREATE INDEX "split_children_split_order_id_idx" ON "split_children"("split_order_id");

-- CreateIndex
CREATE INDEX "split_children_swap_id_idx" ON "split_children"("swap_id");

-- AddForeignKey
ALTER TABLE "split_children" ADD CONSTRAINT "split_children_split_order_id_fkey" FOREIGN KEY ("split_order_id") REFERENCES "split_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "split_children" ADD CONSTRAINT "split_children_swap_id_fkey" FOREIGN KEY ("swap_id") REFERENCES "swaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
