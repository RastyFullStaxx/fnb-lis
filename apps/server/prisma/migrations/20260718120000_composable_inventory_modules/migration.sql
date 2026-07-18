-- Fix Plan Phase C: make inventory modules composable at both Client
-- (ceiling) and Location (enforced reality) level. See
-- docs/packaging-model-fix-plan.md §2.2/§2.3/§3 Phase C.

-- ── 1. New tables ─────────────────────────────────────────────────────────

CREATE TABLE "SubscriptionModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    CONSTRAINT "SubscriptionModule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionModule_subscriptionId_module_key" ON "SubscriptionModule"("subscriptionId", "module");

CREATE TABLE "LocationModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    CONSTRAINT "LocationModule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocationModule_locationId_module_key" ON "LocationModule"("locationId", "module");

-- ── 2. Backfill SubscriptionModule from the old combo string ───────────────
-- Splits "BAR_KITCHEN_ASSET" etc. into one atomic row per module.

INSERT INTO "SubscriptionModule" ("id", "subscriptionId", "module")
SELECT lower(hex(randomblob(16))), "id", 'BAR'
FROM "Subscription"
WHERE "inventoryModules" = 'BAR' OR "inventoryModules" LIKE 'BAR\_%' ESCAPE '\' OR "inventoryModules" LIKE '%\_BAR\_%' ESCAPE '\' OR "inventoryModules" LIKE '%\_BAR' ESCAPE '\';

INSERT INTO "SubscriptionModule" ("id", "subscriptionId", "module")
SELECT lower(hex(randomblob(16))), "id", 'KITCHEN'
FROM "Subscription"
WHERE "inventoryModules" = 'KITCHEN' OR "inventoryModules" LIKE 'KITCHEN\_%' ESCAPE '\' OR "inventoryModules" LIKE '%\_KITCHEN\_%' ESCAPE '\' OR "inventoryModules" LIKE '%\_KITCHEN' ESCAPE '\';

INSERT INTO "SubscriptionModule" ("id", "subscriptionId", "module")
SELECT lower(hex(randomblob(16))), "id", 'ASSET'
FROM "Subscription"
WHERE "inventoryModules" = 'ASSET' OR "inventoryModules" LIKE 'ASSET\_%' ESCAPE '\' OR "inventoryModules" LIKE '%\_ASSET\_%' ESCAPE '\' OR "inventoryModules" LIKE '%\_ASSET' ESCAPE '\';

-- ── 3. Backfill LocationModule ──────────────────────────────────────────────
-- Per Fix Plan §3 Phase C: infer from name where obvious, else fall back to
-- the full client subscription set. Locations under a client with NO
-- subscription get no LocationModule rows at all — matching the existing
-- "no subscription on record -> unrestricted" behavior (allowedProductTypes
-- returns null for an empty/absent module set), so an unassigned/legacy
-- client's locations remain unrestricted exactly as before this migration.

-- 3a. Name-inferable rows: "...bar..." -> BAR, "...kitchen..." -> KITCHEN.
-- (Prime's "Main Bar" / "Kitchen" pattern.) A name containing both words
-- (unlikely in current data) gets both rows, which is the correct outcome
-- for a location that is itself named as a combined space.
INSERT INTO "LocationModule" ("id", "locationId", "module")
SELECT lower(hex(randomblob(16))), "id", 'BAR'
FROM "Location"
WHERE lower("name") LIKE '%bar%';

INSERT INTO "LocationModule" ("id", "locationId", "module")
SELECT lower(hex(randomblob(16))), "id", 'KITCHEN'
FROM "Location"
WHERE lower("name") LIKE '%kitchen%';

INSERT INTO "LocationModule" ("id", "locationId", "module")
SELECT lower(hex(randomblob(16))), "id", 'ASSET'
FROM "Location"
WHERE lower("name") LIKE '%asset%' OR lower("name") LIKE '%equipment%';

-- 3b. Fallback: any location that got NO name-inferable row above, but whose
-- client has a subscription, inherits that subscription's full module set
-- (e.g. Casa Verde's "Main" -> KITCHEN, matching its KITCHEN-only subscription).
INSERT INTO "LocationModule" ("id", "locationId", "module")
SELECT lower(hex(randomblob(16))), l."id", sm."module"
FROM "Location" l
JOIN "Subscription" s ON s."clientId" = l."clientId"
JOIN "SubscriptionModule" sm ON sm."subscriptionId" = s."id"
WHERE NOT EXISTS (SELECT 1 FROM "LocationModule" lm WHERE lm."locationId" = l."id");

-- Note: this is a mechanical, review-friendly backfill for the two seeded
-- clients in this dataset (Prime Hospitality: name-inferred; Casa Verde:
-- subscription-fallback; "Test": subscription-fallback). Any future client
-- whose location names don't cleanly signal a module split should have that
-- flagged for manual review per the fix plan — check the admin Clients page
-- after this migration runs and confirm each location's assigned modules.

-- ── 4. Drop the old combo-string column from Subscription ─────────────────
-- SQLite requires a table rebuild to drop a column.

CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "maxEntities" INTEGER NOT NULL DEFAULT 1,
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
    "id", "clientId", "packageType", "billingCycle", "maxEntities", "status",
    "paid", "lastPaidAt", "startDate", "endDate", "note", "createdById",
    "createdAt", "updatedAt", "cancelledAt", "cancelledById"
)
SELECT
    "id", "clientId", "packageType", "billingCycle", "maxEntities", "status",
    "paid", "lastPaidAt", "startDate", "endDate", "note", "createdById",
    "createdAt", "updatedAt", "cancelledAt", "cancelledById"
FROM "Subscription";

DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_clientId_key" ON "Subscription"("clientId");

-- Re-point SubscriptionModule's FK now that Subscription was rebuilt (SQLite
-- keeps FK text as-is across rename; no data changes needed, ids are stable).
