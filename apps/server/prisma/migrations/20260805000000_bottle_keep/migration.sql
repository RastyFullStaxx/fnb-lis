-- Bottle Keep: a bottle a customer paid for and left to finish next visit.
--
-- One row per bottle, never a quantity — ten bottles under ten guests are ten
-- rows, which is the only shape that can say whose is whose and when each one
-- expires. Additive; nothing existing reads this table yet.

CREATE TABLE "BottleKeep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "areaId" TEXT,
    "locationItemId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerContact" TEXT,
    "qty" REAL NOT NULL DEFAULT 1,
    "remainingContent" REAL NOT NULL DEFAULT 0,
    "keptDate" TEXT NOT NULL,
    "expiresOn" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "claimedAt" DATETIME,
    "claimedById" TEXT,
    "forfeitedAt" DATETIME,
    "forfeitId" TEXT,
    "note" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BottleKeep_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BottleKeep_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "LocationArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BottleKeep_locationItemId_fkey" FOREIGN KEY ("locationItemId") REFERENCES "LocationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BottleKeep_forfeitId_fkey" FOREIGN KEY ("forfeitId") REFERENCES "Forfeit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BottleKeep_forfeitId_key" ON "BottleKeep"("forfeitId");
CREATE INDEX "BottleKeep_locationId_status_expiresOn_idx" ON "BottleKeep"("locationId", "status", "expiresOn");
CREATE INDEX "BottleKeep_locationId_customerName_idx" ON "BottleKeep"("locationId", "customerName");
