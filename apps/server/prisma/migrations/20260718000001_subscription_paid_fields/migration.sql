-- AlterTable: add paid tracking fields to Subscription
ALTER TABLE "Subscription" ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "lastPaidAt" DATETIME;
