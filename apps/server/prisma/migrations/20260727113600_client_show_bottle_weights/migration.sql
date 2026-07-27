-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "costBasis" TEXT NOT NULL DEFAULT 'PRICE',
    "varianceThresholdPct" REAL NOT NULL DEFAULT 11,
    "showBottleWeights" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Client" ("costBasis", "createdAt", "id", "name", "status", "varianceThresholdPct") SELECT "costBasis", "createdAt", "id", "name", "status", "varianceThresholdPct" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
