-- Fix Plan Phase D: introduce the `Plan` catalog (the sellable template an
-- admin composes so sales can create new packaging combos without an
-- engineer redeploying code), and migrate every existing Subscription onto
-- it. See docs/packaging-model-fix-plan.md §2.1/§2.2/§3 Phase D.

-- ── 1. New tables ─────────────────────────────────────────────────────────

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "maxEntities" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT
);

CREATE TABLE "PlanModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    CONSTRAINT "PlanModule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlanModule_planId_module_key" ON "PlanModule"("planId", "module");

-- ── 2. Add planId / negotiatedPrice to Subscription ─────────────────────────
-- SQLite can't add a FOREIGN KEY constraint via plain ALTER TABLE ADD COLUMN,
-- so this rebuilds the table (same pattern as the composable_inventory_modules
-- migration used for its own Subscription rebuild).

CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "planId" TEXT,
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
    CONSTRAINT "Subscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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

-- Re-point SubscriptionModule's FK now that Subscription was rebuilt again
-- (same as the previous migration's rebuild — ids are stable, no data lost).

-- ── 3. Seed a handful of clean starter Plans ────────────────────────────────
-- The original five module combos (Bar / Kitchen / Asset / Bar+Kitchen /
-- Bar+Kitchen+Asset) × two billing cycles, for use going forward (Fix Plan
-- §3 Phase D). maxEntities mirrors the BASIC/MEDIUM/ONE_TIME defaults in
-- packages/core/src/constants.ts (PACKAGE_DEFAULT_MAX_ENTITIES) so a starter
-- plan's ceiling matches what an admin would have picked via the old
-- package-tier dropdown.

INSERT INTO "Plan" ("id", "name", "billingCycle", "maxEntities", "isActive", "sortOrder", "createdAt") VALUES
  ('starter-bar-monthly',              'Bar Only — Monthly',                'MONTHLY',    1, true, 10, CURRENT_TIMESTAMP),
  ('starter-kitchen-monthly',          'Kitchen Only — Monthly',            'MONTHLY',    1, true, 20, CURRENT_TIMESTAMP),
  ('starter-asset-monthly',            'Asset Only — Monthly',              'MONTHLY',    1, true, 30, CURRENT_TIMESTAMP),
  ('starter-bar-kitchen-monthly',      'Bar + Kitchen — Monthly',           'MONTHLY',    5, true, 40, CURRENT_TIMESTAMP),
  ('starter-full-suite-monthly',       'Full Suite — Monthly',              'MONTHLY',    5, true, 50, CURRENT_TIMESTAMP),
  ('starter-bar-onetime',              'Bar Only — One-Time',               'STANDALONE', 0, true, 60, CURRENT_TIMESTAMP),
  ('starter-kitchen-onetime',          'Kitchen Only — One-Time',           'STANDALONE', 0, true, 70, CURRENT_TIMESTAMP),
  ('starter-asset-onetime',            'Asset Only — One-Time',             'STANDALONE', 0, true, 80, CURRENT_TIMESTAMP),
  ('starter-bar-kitchen-onetime',      'Bar + Kitchen — One-Time',          'STANDALONE', 0, true, 90, CURRENT_TIMESTAMP),
  ('starter-full-suite-onetime',       'Full Suite — One-Time',             'STANDALONE', 0, true, 100, CURRENT_TIMESTAMP);

INSERT INTO "PlanModule" ("id", "planId", "module") VALUES
  (lower(hex(randomblob(16))), 'starter-bar-monthly',         'BAR'),
  (lower(hex(randomblob(16))), 'starter-kitchen-monthly',     'KITCHEN'),
  (lower(hex(randomblob(16))), 'starter-asset-monthly',       'ASSET'),
  (lower(hex(randomblob(16))), 'starter-bar-kitchen-monthly', 'BAR'),
  (lower(hex(randomblob(16))), 'starter-bar-kitchen-monthly', 'KITCHEN'),
  (lower(hex(randomblob(16))), 'starter-full-suite-monthly',  'BAR'),
  (lower(hex(randomblob(16))), 'starter-full-suite-monthly',  'KITCHEN'),
  (lower(hex(randomblob(16))), 'starter-full-suite-monthly',  'ASSET'),
  (lower(hex(randomblob(16))), 'starter-bar-onetime',         'BAR'),
  (lower(hex(randomblob(16))), 'starter-kitchen-onetime',     'KITCHEN'),
  (lower(hex(randomblob(16))), 'starter-asset-onetime',       'ASSET'),
  (lower(hex(randomblob(16))), 'starter-bar-kitchen-onetime', 'BAR'),
  (lower(hex(randomblob(16))), 'starter-bar-kitchen-onetime', 'KITCHEN'),
  (lower(hex(randomblob(16))), 'starter-full-suite-onetime',  'BAR'),
  (lower(hex(randomblob(16))), 'starter-full-suite-onetime',  'KITCHEN'),
  (lower(hex(randomblob(16))), 'starter-full-suite-onetime',  'ASSET');

-- ── 4. Migrate every existing Subscription onto a generated legacy Plan ─────
-- Fix Plan §4 open question #3, resolved: migrate, don't leave legacy. For
-- every distinct (billingCycle, maxEntities, module-set) combo actually in
-- use, create one auto-named "Legacy — ..." Plan (renameable by admin
-- afterwards) and backfill planId on every Subscription in that combo. A
-- Subscription whose combo exactly matches a starter Plan seeded above
-- reuses that starter Plan instead of generating a redundant duplicate.

-- 4a. Build a scratch table of each Subscription's sorted module-set key
-- (e.g. "BAR,KITCHEN"), so subscriptions with the same modules regardless of
-- insertion order group into the same combo. Temporary — dropped at the end.
CREATE TEMP TABLE "_subModuleKey" AS
SELECT
    s."id" AS "subscriptionId",
    s."billingCycle" AS "billingCycle",
    s."maxEntities" AS "maxEntities",
    COALESCE(
      (
        SELECT group_concat("module", ',')
        FROM (
          SELECT DISTINCT "module"
          FROM "SubscriptionModule"
          WHERE "subscriptionId" = s."id"
          ORDER BY "module" ASC
        )
      ),
      ''
    ) AS "moduleKey"
FROM "Subscription" s;

-- 4b. Reuse an existing starter Plan wherever the combo matches one exactly.
UPDATE "Subscription"
SET "planId" = (
  SELECT p."id"
  FROM "Plan" p
  JOIN "_subModuleKey" k ON k."subscriptionId" = "Subscription"."id"
  WHERE p."billingCycle" = k."billingCycle"
    AND p."maxEntities" = k."maxEntities"
    AND k."moduleKey" <> ''
    AND (
      SELECT COALESCE(group_concat("module", ','), '')
      FROM (SELECT "module" FROM "PlanModule" WHERE "planId" = p."id" ORDER BY "module" ASC)
    ) = k."moduleKey"
  LIMIT 1
)
WHERE "planId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "Plan" p
    JOIN "_subModuleKey" k ON k."subscriptionId" = "Subscription"."id"
    WHERE p."billingCycle" = k."billingCycle"
      AND p."maxEntities" = k."maxEntities"
      AND k."moduleKey" <> ''
      AND (
        SELECT COALESCE(group_concat("module", ','), '')
        FROM (SELECT "module" FROM "PlanModule" WHERE "planId" = p."id" ORDER BY "module" ASC)
      ) = k."moduleKey"
  );

-- 4c. For every remaining distinct combo (still unmatched — moduleKey may
-- also be '' for a subscription with no SubscriptionModule rows at all),
-- create one generated "Legacy — ..." Plan + its PlanModule rows.
CREATE TEMP TABLE "_legacyCombo" AS
SELECT DISTINCT k."billingCycle", k."maxEntities", k."moduleKey"
FROM "_subModuleKey" k
JOIN "Subscription" s ON s."id" = k."subscriptionId"
WHERE s."planId" IS NULL;

CREATE TEMP TABLE "_legacyComboNamed" AS
SELECT
  lower(hex(randomblob(16))) AS "planId",
  "billingCycle",
  "maxEntities",
  "moduleKey",
  ('Legacy — ' ||
    CASE WHEN "moduleKey" = '' THEN 'No modules' ELSE replace("moduleKey", ',', '+') END ||
    ' / ' || CASE WHEN "maxEntities" = 0 THEN 'Unlimited' ELSE CAST("maxEntities" AS TEXT) || ' loc' END ||
    ' / ' || "billingCycle"
  ) AS "name"
FROM "_legacyCombo";

INSERT INTO "Plan" ("id", "name", "billingCycle", "maxEntities", "isActive", "sortOrder", "createdAt")
SELECT "planId", "name", "billingCycle", "maxEntities", true, 1000, CURRENT_TIMESTAMP
FROM "_legacyComboNamed";

-- One PlanModule row per atomic module in each legacy combo's moduleKey
-- (skips combos with an empty moduleKey — a subscription with no modules on
-- record gets a Plan with no PlanModule rows, which is a legitimate empty set).
INSERT INTO "PlanModule" ("id", "planId", "module")
SELECT lower(hex(randomblob(16))), c."planId", 'BAR'
FROM "_legacyComboNamed" c
WHERE c."moduleKey" = 'BAR' OR c."moduleKey" LIKE 'BAR,%' OR c."moduleKey" LIKE '%,BAR' OR c."moduleKey" LIKE '%,BAR,%';

INSERT INTO "PlanModule" ("id", "planId", "module")
SELECT lower(hex(randomblob(16))), c."planId", 'KITCHEN'
FROM "_legacyComboNamed" c
WHERE c."moduleKey" = 'KITCHEN' OR c."moduleKey" LIKE 'KITCHEN,%' OR c."moduleKey" LIKE '%,KITCHEN' OR c."moduleKey" LIKE '%,KITCHEN,%';

INSERT INTO "PlanModule" ("id", "planId", "module")
SELECT lower(hex(randomblob(16))), c."planId", 'ASSET'
FROM "_legacyComboNamed" c
WHERE c."moduleKey" = 'ASSET' OR c."moduleKey" LIKE 'ASSET,%' OR c."moduleKey" LIKE '%,ASSET' OR c."moduleKey" LIKE '%,ASSET,%';

-- 4d. Backfill planId on every Subscription still unmatched, from its combo's
-- newly generated legacy Plan.
UPDATE "Subscription"
SET "planId" = (
  SELECT c."planId"
  FROM "_legacyComboNamed" c
  JOIN "_subModuleKey" k ON k."subscriptionId" = "Subscription"."id"
  WHERE c."billingCycle" = k."billingCycle"
    AND c."maxEntities" = k."maxEntities"
    AND c."moduleKey" = k."moduleKey"
  LIMIT 1
)
WHERE "planId" IS NULL;

-- No subscription should be left with planId = null after this migration
-- (Fix Plan §3 Phase D acceptance criterion) — every row matched either a
-- starter Plan (4b) or a generated legacy Plan (4c/4d) above.

DROP TABLE "_subModuleKey";
DROP TABLE "_legacyCombo";
DROP TABLE "_legacyComboNamed";
