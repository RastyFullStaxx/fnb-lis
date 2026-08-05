-- Report access by subscription tier (client req #3, 2026-08-02 brief).
-- See docs/2026-08-04-report-tier-gating-plan.md. Same shape as
-- SubscriptionModule: one row per report slug this subscription may open.
-- Nothing reads this table yet -- added ahead of the gating logic so the
-- later phases have a table to seed and query.

-- CreateTable
CREATE TABLE "SubscriptionReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "reportSlug" TEXT NOT NULL,
    CONSTRAINT "SubscriptionReport_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionReport_subscriptionId_reportSlug_key" ON "SubscriptionReport"("subscriptionId", "reportSlug");
