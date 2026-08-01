-- Tamper-evidence for the audit trail (docs/security.md).
--
-- Nullable on purpose: rows written before this shipped have no chain, and the
-- verifier reports where the chain BEGINS rather than treating pre-existing
-- history as corrupt. SQLite permits many NULLs under a UNIQUE index, so the
-- constraint on `seq` does not conflict with the backfill.
ALTER TABLE "ActivityLog" ADD COLUMN "hash" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "seq" INTEGER;

CREATE UNIQUE INDEX "ActivityLog_seq_key" ON "ActivityLog"("seq");
