/*
  Warnings:

  - You are about to alter the column `price_impact` on the `quotes` table. The data in that column could be lost. The data in that column will be cast from `Decimal(78,0)` to `Decimal(78,18)`.
  - You are about to alter the column `price_impact` on the `route_candidates` table. The data in that column could be lost. The data in that column will be cast from `Decimal(78,0)` to `Decimal(78,18)`.
  - You are about to alter the column `route_score` on the `route_candidates` table. The data in that column could be lost. The data in that column will be cast from `Decimal(78,0)` to `Decimal(78,18)`.

*/
-- AlterTable
ALTER TABLE "quotes" ALTER COLUMN "price_impact" SET DATA TYPE DECIMAL(78,18);

-- AlterTable
ALTER TABLE "route_candidates" ALTER COLUMN "price_impact" SET DATA TYPE DECIMAL(78,18),
ALTER COLUMN "route_score" SET DATA TYPE DECIMAL(78,18);
