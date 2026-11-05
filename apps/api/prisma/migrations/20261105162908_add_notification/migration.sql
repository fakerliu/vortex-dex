-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "alert_id" TEXT,
    "token_address" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_address_read_idx" ON "notifications"("user_address", "read");

-- CreateIndex
CREATE INDEX "notifications_user_address_created_at_idx" ON "notifications"("user_address", "created_at");
