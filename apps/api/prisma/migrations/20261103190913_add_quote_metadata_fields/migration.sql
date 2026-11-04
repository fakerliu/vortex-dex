/*
  Warnings:

  - Added the required column `chain_id` to the `quotes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "block_number" INTEGER,
ADD COLUMN     "chain_id" INTEGER NOT NULL,
ADD COLUMN     "minimum_received" DECIMAL(78,0),
ADD COLUMN     "price" TEXT,
ADD COLUMN     "protocol" TEXT,
ADD COLUMN     "route" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "swap_fee" TEXT;
