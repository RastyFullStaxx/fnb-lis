-- Corrective migration.
--
-- 20260724070711_add_asset_industry_field declared `industry` on Category in
-- schema.prisma but added the column to LocationItem, so `Category.industry`
-- never existed in any database built from migrations. Every query that
-- includes Category — which is most of the reporting layer, via
-- report-assembly.ts — failed with P2022 ColumnNotFound.
--
-- The original migration is already applied, so it is left untouched: editing
-- it would break the recorded checksum for anyone who has run it. This adds
-- the column where the schema says it belongs.
ALTER TABLE "Category" ADD COLUMN "industry" TEXT;

-- The stray LocationItem."industry" is deliberately left in place: it is
-- nullable, absent from schema.prisma, and therefore never read or written by
-- Prisma. Dropping it would need a full SQLite table rebuild for no gain.
