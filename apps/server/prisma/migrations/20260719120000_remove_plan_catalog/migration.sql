-- Remove the Plan catalog entirely. See docs handoff:
-- "Remove the Plan Catalog, Keep Direct Fields on Clients".
--
-- billingCycle / maxEntities / modules already live directly on Subscription
-- (and SubscriptionModule) — that snapshot was the whole point of the
-- original "snapshot, don't link" design, so dropping planId loses no
-- client-facing data. Existing Plan/PlanModule rows are simply dropped.

-- ── 1. Rebuild Subscription without planId ──────────────────────────────────
-- SQLite can't drop a column with a FK via plain ALTER TABLE, so this follows
-- the same table-rebuild pattern as the two prior Subscription rebuilds
-- (20260718120000_composable_inventory_modules, 20260719000000_plan_catalog).

CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "maxEntities" INTEGER NOT NULL DEFAULT 1,
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

INSERT INTO "new_Subscription" (
    "id", "clientId", "packageType", "billingCycle", "maxEntities", "negotiatedPrice",
    "status", "paid", "lastPaidAt", "startDate", "endDate", "note", "createdById",
    "createdAt", "updatedAt", "cancelledAt", "cancelledById"
)
SELECT
    "id", "clientId", "packageType", "billingCycle", "maxEntities", "negotiatedPrice",
    "status", "paid", "lastPaidAt", "startDate", "endDate", "note", "createdById",
    "createdAt", "updatedAt", "cancelledAt", "cancelledById"
FROM "Subscription";

DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_clientId_key" ON "Subscription"("clientId");

-- Re-point SubscriptionModule's FK now that Subscription was rebuilt again
-- (same as the prior rebuilds — ids are stable, no data lost).

-- ── 2. Drop the Plan catalog tables ─────────────────────────────────────────
-- FK order: PlanModule (child, references Plan) before Plan (parent).

DROP TABLE "PlanModule";
DROP TABLE "Plan";
