-- AlterTable
ALTER TABLE "CountSession" ADD COLUMN "originDeviceId" TEXT;

-- AlterTable
ALTER TABLE "Forfeit" ADD COLUMN "originDeviceId" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "originDeviceId" TEXT;

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN "originDeviceId" TEXT;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN "originDeviceId" TEXT;

-- CreateTable
CREATE TABLE "SyncOp" (
    "opId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SyncOp_appliedAt_idx" ON "SyncOp"("appliedAt");

-- CreateIndex
CREATE INDEX "SyncOp_entity_entityId_idx" ON "SyncOp"("entity", "entityId");
