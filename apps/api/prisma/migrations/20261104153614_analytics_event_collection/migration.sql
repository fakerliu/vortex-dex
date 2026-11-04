-- DropForeignKey
ALTER TABLE "swap_events" DROP CONSTRAINT "swap_events_swap_id_fkey";

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "intent_id" TEXT,
ADD COLUMN     "response_ms" INTEGER,
ADD COLUMN     "user_address" TEXT;

-- AlterTable
ALTER TABLE "route_candidates" ADD COLUMN     "intent_id" TEXT,
ADD COLUMN     "is_selected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quote_id" TEXT,
ADD COLUMN     "route_compute_ms" INTEGER;

-- AlterTable
ALTER TABLE "swaps" ADD COLUMN     "effective_gas_price" TEXT,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "gas_used" TEXT,
ADD COLUMN     "intent_id" TEXT,
ADD COLUMN     "quote_id" TEXT;

-- AlterTable
ALTER TABLE "sync_state" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "event_time" TIMESTAMP(3) NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "chain_id" INTEGER,
    "wallet_address" TEXT,
    "session_id" TEXT,
    "intent_id" TEXT,
    "request_id" TEXT,
    "properties" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_intents" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "wallet_address" TEXT,
    "chain_id" INTEGER,
    "token_in" TEXT,
    "token_out" TEXT,
    "amount_in" TEXT,
    "quote_id" TEXT,
    "route_id" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "analytics_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_funnel_events" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "properties" TEXT,

    CONSTRAINT "analytics_funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_metrics" (
    "id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "metric_value" TEXT NOT NULL,
    "metric_unit" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "dimensions" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "error_code" TEXT NOT NULL,
    "error_type" TEXT NOT NULL,
    "message" TEXT,
    "service" TEXT,
    "intent_id" TEXT,
    "request_id" TEXT,
    "chain_id" INTEGER,
    "context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_event_id_key" ON "analytics_events"("event_id");

-- CreateIndex
CREATE INDEX "analytics_events_event_name_event_time_idx" ON "analytics_events"("event_name", "event_time");

-- CreateIndex
CREATE INDEX "analytics_events_intent_id_idx" ON "analytics_events"("intent_id");

-- CreateIndex
CREATE INDEX "analytics_events_wallet_address_idx" ON "analytics_events"("wallet_address");

-- CreateIndex
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_intents_intent_id_key" ON "analytics_intents"("intent_id");

-- CreateIndex
CREATE INDEX "analytics_intents_wallet_address_idx" ON "analytics_intents"("wallet_address");

-- CreateIndex
CREATE INDEX "analytics_intents_status_idx" ON "analytics_intents"("status");

-- CreateIndex
CREATE INDEX "analytics_intents_started_at_idx" ON "analytics_intents"("started_at");

-- CreateIndex
CREATE INDEX "analytics_funnel_events_intent_id_step_idx" ON "analytics_funnel_events"("intent_id", "step");

-- CreateIndex
CREATE INDEX "analytics_funnel_events_step_name_idx" ON "analytics_funnel_events"("step_name");

-- CreateIndex
CREATE INDEX "analytics_funnel_events_occurred_at_idx" ON "analytics_funnel_events"("occurred_at");

-- CreateIndex
CREATE INDEX "system_metrics_service_name_metric_name_timestamp_idx" ON "system_metrics"("service_name", "metric_name", "timestamp");

-- CreateIndex
CREATE INDEX "system_metrics_timestamp_idx" ON "system_metrics"("timestamp");

-- CreateIndex
CREATE INDEX "error_events_error_code_created_at_idx" ON "error_events"("error_code", "created_at");

-- CreateIndex
CREATE INDEX "error_events_error_type_idx" ON "error_events"("error_type");

-- CreateIndex
CREATE INDEX "error_events_intent_id_idx" ON "error_events"("intent_id");

-- CreateIndex
CREATE INDEX "quotes_intent_id_idx" ON "quotes"("intent_id");

-- CreateIndex
CREATE INDEX "quotes_user_address_idx" ON "quotes"("user_address");

-- CreateIndex
CREATE INDEX "route_candidates_intent_id_idx" ON "route_candidates"("intent_id");

-- CreateIndex
CREATE INDEX "route_candidates_quote_id_idx" ON "route_candidates"("quote_id");

-- CreateIndex
CREATE INDEX "swaps_intent_id_idx" ON "swaps"("intent_id");

-- CreateIndex
CREATE INDEX "swaps_quote_id_idx" ON "swaps"("quote_id");

-- AddForeignKey
ALTER TABLE "swap_events" ADD CONSTRAINT "swap_events_swap_id_fkey" FOREIGN KEY ("swap_id") REFERENCES "swaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
