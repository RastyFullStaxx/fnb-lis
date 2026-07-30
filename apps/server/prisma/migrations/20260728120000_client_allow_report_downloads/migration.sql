-- Client req 2026-07-28: the LIS admin can release report VIEWING to an
-- establishment while withholding DOWNLOADS — separate from, and additional to,
-- the billing lockout (an unpaid client loses downloads automatically).
-- Defaults to true so every existing client keeps the access it has today.
ALTER TABLE "Client" ADD COLUMN "allowReportDownloads" BOOLEAN NOT NULL DEFAULT true;
