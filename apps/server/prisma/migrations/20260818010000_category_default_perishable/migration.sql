-- Expiry Date, Phase 1.1 (expiry-date-phases.md): the category-level policy
-- layer for whether items in a category spoil. Wine, Beer, Vodka, and Whisky
-- all share productType "Beverage" but only some of them spoil, so the flag
-- lives on Category, not productType.
--
-- Defaults true so every existing category row, and every category created
-- after this migration lands before seed data is updated, starts perishable
-- — most of the catalog spoils; true spirits are the seeded exception
-- (see seed.ts's seedCategories()).
ALTER TABLE "Category" ADD COLUMN "defaultPerishable" BOOLEAN NOT NULL DEFAULT true;
