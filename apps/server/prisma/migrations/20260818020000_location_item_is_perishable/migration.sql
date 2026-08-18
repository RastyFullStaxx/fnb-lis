-- Expiry Date, Phase 1.2 (expiry-date-phases.md): per-location override of
-- Category.defaultPerishable. Null = inherit the category default; set =
-- this establishment's own call for this one catalog row (e.g. tracking
-- expiry on Cooking Oil even though most Dry Goods items aren't tracked).
--
-- Same nullable-override shape as LocationItem.tareWeight / densityFactor
-- (deviation #27) — a repeat of an already-shipped migration pattern, not a
-- new one. No default: null is the meaningful starting state, not false.
ALTER TABLE "LocationItem" ADD COLUMN "isPerishable" BOOLEAN;
