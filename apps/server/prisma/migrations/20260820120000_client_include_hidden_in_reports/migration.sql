-- Hiding clutter items from reports (docs/clutter-in-reports-decision.md).
-- Off by default, per the client's stated preference: when off, a hidden
-- item's row drops out of a report only if it has zero activity in that
-- report's period; an item with real activity in the period always stays
-- visible, regardless of this setting, so totals never move because of it.
-- Editable in Settings by ADMIN/MANAGER only, same gate as
-- varianceThresholdPct. Additive only, no backfill needed.
ALTER TABLE "Client" ADD COLUMN "includeHiddenInReports" BOOLEAN NOT NULL DEFAULT false;
