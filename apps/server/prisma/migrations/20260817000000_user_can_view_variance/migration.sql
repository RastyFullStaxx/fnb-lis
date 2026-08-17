-- Hide Variance from Staff (hide-variance-from-staff-plan.md): a per-STAFF-
-- account gate on the numbers that can back-solve a fake count — Variance
-- itself, Usage, Sold, and Par Level's "Used (last period)" column.
--
-- Defaults to false so every STAFF account, new or existing, starts blocked
-- the moment this ships — no grandfathering. Trust is a manager's deliberate
-- grant (PERMISSIONS["variance.grant"]: ADMIN/OWNER/MANAGER), not a default
-- this migration hands out. Every other role's access is unconditional and
-- never reads this column.
ALTER TABLE "User" ADD COLUMN "canViewVariance" BOOLEAN NOT NULL DEFAULT false;
