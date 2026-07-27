-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "maxEntities" INTEGER NOT NULL DEFAULT 1,
    "maxUsers" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_Subscription" ("billingCycle", "cancelledAt", "cancelledById", "clientId", "createdAt", "createdById", "endDate", "id", "lastPaidAt", "maxEntities", "negotiatedPrice", "note", "packageType", "paid", "startDate", "status", "updatedAt") SELECT "billingCycle", "cancelledAt", "cancelledById", "clientId", "createdAt", "createdById", "endDate", "id", "lastPaidAt", "maxEntities", "negotiatedPrice", "note", "packageType", "paid", "startDate", "status", "updatedAt" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_clientId_key" ON "Subscription"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
