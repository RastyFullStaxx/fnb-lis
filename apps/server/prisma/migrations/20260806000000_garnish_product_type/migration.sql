-- Garnish becomes an assignable product type (client decision 2026-08-04:
-- "parehas" — visible to bar AND kitchen locations).
--
-- The module gate lives in code (MODULE_PRODUCT_TYPES); this is the other half:
-- the per-client list an administrator picks from when labelling a category.
-- New installs get it from the seed, so this is only for databases that already
-- exist.
--
-- json_insert appends rather than rewriting the array, so any product type an
-- administrator added by hand survives. Guarded on NOT LIKE so re-running is a
-- no-op and nobody ends up with two Garnishes.
UPDATE "Setting"
SET "value" = json_insert("value", '$[#]', 'Garnish')
WHERE "key" = 'productTypes'
  AND json_valid("value")
  AND "value" NOT LIKE '%Garnish%';
