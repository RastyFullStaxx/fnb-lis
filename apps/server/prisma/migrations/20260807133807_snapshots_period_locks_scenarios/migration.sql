-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT,
    "note" TEXT,
    "paramsJson" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenById" TEXT NOT NULL,
    "takenByName" TEXT NOT NULL,
    "supersedesId" TEXT
);

-- CreateTable
CREATE TABLE "PeriodLock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "begin" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "reason" TEXT,
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedById" TEXT NOT NULL,
    "lockedByName" TEXT NOT NULL,
    "releasedAt" DATETIME,
    "releasedById" TEXT,
    "releaseReason" TEXT
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "begin" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "basedOnSnapshotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ScenarioEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "locationItemId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "unitCost" REAL,
    "unitPrice" REAL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScenarioEntry_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReportSnapshot_locationId_slug_takenAt_idx" ON "ReportSnapshot"("locationId", "slug", "takenAt");

-- CreateIndex
CREATE INDEX "PeriodLock_locationId_status_idx" ON "PeriodLock"("locationId", "status");

-- CreateIndex
CREATE INDEX "Scenario_locationId_status_idx" ON "Scenario"("locationId", "status");

-- CreateIndex
CREATE INDEX "ScenarioEntry_scenarioId_idx" ON "ScenarioEntry"("scenarioId");
