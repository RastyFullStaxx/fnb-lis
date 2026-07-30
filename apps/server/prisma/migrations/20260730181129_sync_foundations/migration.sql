-- Sync foundations — everything the offline desktop mirror needs to exist in
-- the server schema BEFORE any Electron code is written. See
-- docs/sync-and-data-lifecycle.md.
--
--   Device            registered desktop identity; the thing a licence binds to
--                     (proposal §20) and the thing revocation acts on.
--   AuthSession.deviceId  marks a session as belonging to a desktop, which is
--                     what earns it the long non-sliding TTL.
--   Subscription.maxDevices  the licence as a number (§18 "one (1) computer").
--   *.occurredAt      when the user did the work, as against when the server
--                     received it. Purely additive and nullable — no backfill,
--                     and no report reads it, so the golden fixtures cannot move.
--
-- The LocationItem rebuild below is NOT part of that: it finally drops the
-- stray `industry` column that 20260724070711 added to the wrong table (see
-- 20260728060000 for the full story). That migration chose to leave it, on the
-- grounds that dropping it needed a whole-table rebuild for no gain. The gain
-- has since appeared: Prisma regenerates this drop on every `migrate dev`, so
-- leaving it means living with permanent drift noise in every future
-- migration. Verified empty before dropping — 172 rows, 0 non-null.

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "CountLine" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "CountSession" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "Forfeit" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "PurchaseLine" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "TransferLine" ADD COLUMN "occurredAt" DATETIME;

-- AlterTable
ALTER TABLE "TransferReceiptLine" ADD COLUMN "occurredAt" DATETIME;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "lastSyncAt" DATETIME,
    CONSTRAINT "Device_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Device_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceId" TEXT,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuthSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuthSession" ("createdAt", "expiresAt", "id", "ip", "tokenHash", "userAgent", "userId") SELECT "createdAt", "expiresAt", "id", "ip", "tokenHash", "userAgent", "userId" FROM "AuthSession";
DROP TABLE "AuthSession";
ALTER TABLE "new_AuthSession" RENAME TO "AuthSession";
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_deviceId_idx" ON "AuthSession"("deviceId");
CREATE TABLE "new_LocationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "itemVariantId" TEXT NOT NULL,
    "cost" REAL NOT NULL DEFAULT 0,
    "retail" REAL NOT NULL DEFAULT 0,
    "parLevel" REAL,
    "tareWeight" REAL,
    "tareWeightUnit" TEXT,
    "densityFactor" REAL,
    "assetCode" TEXT,
    "initialCost" REAL,
    "serialNo" TEXT,
    "condition" TEXT,
    "status" TEXT,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LocationItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LocationItem_itemVariantId_fkey" FOREIGN KEY ("itemVariantId") REFERENCES "ItemVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LocationItem" ("assetCode", "condition", "cost", "createdAt", "densityFactor", "id", "initialCost", "isActive", "itemVariantId", "locationId", "parLevel", "remarks", "retail", "serialNo", "status", "tareWeight", "tareWeightUnit", "updatedAt", "updatedById") SELECT "assetCode", "condition", "cost", "createdAt", "densityFactor", "id", "initialCost", "isActive", "itemVariantId", "locationId", "parLevel", "remarks", "retail", "serialNo", "status", "tareWeight", "tareWeightUnit", "updatedAt", "updatedById" FROM "LocationItem";
DROP TABLE "LocationItem";
ALTER TABLE "new_LocationItem" RENAME TO "LocationItem";
CREATE UNIQUE INDEX "LocationItem_assetCode_key" ON "LocationItem"("assetCode");
CREATE UNIQUE INDEX "LocationItem_locationId_itemVariantId_key" ON "LocationItem"("locationId", "itemVariantId");
CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "maxEntities" INTEGER NOT NULL DEFAULT 1,
    "maxUsers" INTEGER NOT NULL DEFAULT 0,
    "maxDevices" INTEGER NOT NULL DEFAULT 1,
    "negotiatedPrice" REAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "lastPaidAt" DATETIME,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    CONSTRAINT "Subscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Subscription" ("billingCycle", "cancelledAt", "cancelledById", "clientId", "createdAt", "createdById", "endDate", "id", "lastPaidAt", "maxEntities", "maxUsers", "negotiatedPrice", "note", "packageType", "paid", "startDate", "status", "updatedAt") SELECT "billingCycle", "cancelledAt", "cancelledById", "clientId", "createdAt", "createdById", "endDate", "id", "lastPaidAt", "maxEntities", "maxUsers", "negotiatedPrice", "note", "packageType", "paid", "startDate", "status", "updatedAt" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_clientId_key" ON "Subscription"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Device_fingerprint_key" ON "Device"("fingerprint");

-- CreateIndex
CREATE INDEX "Device_clientId_idx" ON "Device"("clientId");
