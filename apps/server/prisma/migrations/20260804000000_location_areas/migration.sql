-- Storage areas within a location, and the optional area on a count line.
--
-- Additive only: every existing CountLine keeps areaId NULL, which is the same
-- shape as a location that does not split its stock. No backfill, and no change
-- to how counts aggregate — report-assembly already sums lines per item.

CREATE TABLE "LocationArea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocationArea_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocationArea_locationId_name_key" ON "LocationArea"("locationId", "name");
CREATE INDEX "LocationArea_locationId_idx" ON "LocationArea"("locationId");

ALTER TABLE "CountLine" ADD COLUMN "areaId" TEXT REFERENCES "LocationArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CountLine_areaId_idx" ON "CountLine"("areaId");
