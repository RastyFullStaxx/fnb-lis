-- CreateTable
CREATE TABLE "LegacyMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legacyTable" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "newId" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LegacyMap_legacyTable_legacyId_key" ON "LegacyMap"("legacyTable", "legacyId");
