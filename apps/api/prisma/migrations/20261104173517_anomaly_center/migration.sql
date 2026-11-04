-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" TEXT NOT NULL,
    "window_minutes" INTEGER NOT NULL DEFAULT 60,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomaly_events" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT,
    "rule_name" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "metric_value" TEXT NOT NULL,
    "threshold" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "message" TEXT,
    "context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "anomaly_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_notifications" (
    "id" TEXT NOT NULL,
    "anomaly_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" TEXT,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_rules_metric_name_idx" ON "alert_rules"("metric_name");

-- CreateIndex
CREATE INDEX "alert_rules_is_enabled_idx" ON "alert_rules"("is_enabled");

-- CreateIndex
CREATE INDEX "anomaly_events_rule_id_idx" ON "anomaly_events"("rule_id");

-- CreateIndex
CREATE INDEX "anomaly_events_status_idx" ON "anomaly_events"("status");

-- CreateIndex
CREATE INDEX "anomaly_events_severity_idx" ON "anomaly_events"("severity");

-- CreateIndex
CREATE INDEX "anomaly_events_created_at_idx" ON "anomaly_events"("created_at");

-- CreateIndex
CREATE INDEX "alert_notifications_anomaly_id_idx" ON "alert_notifications"("anomaly_id");

-- CreateIndex
CREATE INDEX "alert_notifications_status_idx" ON "alert_notifications"("status");
