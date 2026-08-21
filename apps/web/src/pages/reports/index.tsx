import { Link } from "react-router";
import { canViewReport, canViewReportForSubscription, canViewVariance, type Role, allowedProductTypes } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCurrentClient, useCurrentLocation } from "@/api/location";
import {
  ArrowLeftRight,
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Gauge,
  GlassWater,
  PackageX,
  PieChart,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Undo2,
  Wine,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useLocationId } from "@/api/location";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Report = {
  path: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /**
   * Product types this report needs at least one of to say anything. Omit for
   * the module-agnostic majority — those still make sense with zero rows.
   *
   * Deliberately conservative. Sales is NOT listed: an Asset location uses its
   * Non-revenue tab for breakage/loss write-offs, a decision already taken for
   * the sidebar (asset-module-phases.md 3.3). Par Level is not listed either —
   * a reorder point applies to Supplies as much as to drink.
   */
  requiresProductTypes?: readonly string[];
};

/**
 * Thirteen reports in one flat grid meant reading every description to find
 * one. They group by the question being asked, in the order an audit is
 * actually worked: reconcile the period, explain it through sales, trace the
 * stock that moved, then account for what was written off.
 */
const SECTIONS: Array<{ title: string; blurb: string; reports: Report[] }> = [
  {
    title: "Reconciliation",
    blurb: "Count to count: what should have been used, against what was.",
    reports: [
      {
        path: "legacy-audit",
        icon: BarChart3,
        title: "Full Audit by Category",
        description: "24-column audit grouped by category, with the cost ratio.",
      },
      {
        path: "full-audit?variance=only",
        icon: BarChart3,
        title: "Variance Report",
        description: "Only the items that missed or beat expectation, at cost and retail.",
      },
      {
        path: "variance-summary",
        icon: BarChart3,
        title: "Variance Summary",
        description: "Category-only rollup of the variance: status, brands involved, and short/over at retail.",
      },
      {
        path: "usage-cost",
        icon: Gauge,
        title: "Usage Cost",
        description: "What each item's consumption cost for an audit period.",
      },
      {
        path: "cost-snapshot",
        icon: Coins,
        title: "Beginning / Ending Cost",
        description: "Counted stock on an audit date, valued at cost.",
      },
    ],
  },
  {
    title: "Sales & Revenue",
    blurb: "What was sold, how it was poured, and what it cost to sell.",
    reports: [
      {
        path: "sales",
        // Gated, unlike the Sales NAV item which is deliberately module-agnostic
        // (asset-module-phases.md 3.3). Different objects: the sales *page* is
        // where an asset write-off gets recorded, via its Non-revenue tab; this
        // *report* is about revenue, and an asset location has none. Verified on
        // the Assets location — sales report 0 rows / ₱0, while the write-offs
        // show up in Non-Revenue (7 rows / ₱16,280) where they belong.
        requiresProductTypes: ["Beverage", "Food"],
        icon: Receipt,
        title: "Sales",
        description: "Revenue and quantities by day, item, and menu, with Discounted and Production views.",
      },
      {
        path: "sales-by-item",
        requiresProductTypes: ["Beverage", "Food"],
        icon: GlassWater,
        title: "Sales by Item (Shot & Bottle)",
        description: "Per-item shot and bottle sales for an audit period, with cost of sold and revenue.",
      },
      {
        path: "top-sellers",
        requiresProductTypes: ["Beverage", "Food"],
        icon: TrendingUp,
        title: "Top Sellers",
        description: "Best-selling items, menus, and ingredients by quantity or revenue.",
      },
      {
        path: "cost-analysis",
        requiresProductTypes: ["Beverage", "Food"],
        icon: PieChart,
        title: "Cost Analysis",
        description: "Beverage and food cost: beginning + purchases − ending, as a share of sales.",
      },
    ],
  },
  {
    title: "Stock & Movement",
    blurb: "Everything that came in, went out, or is sitting on the shelf now.",
    reports: [
      {
        path: "purchases",
        icon: ShoppingCart,
        title: "Purchases",
        description: "Deliveries by supplier and date, with contact details and payment terms.",
      },
      {
        path: "transfers",
        icon: ArrowLeftRight,
        title: "Transfers (Requisition)",
        description: "Stock sent to and received from other locations, at cost and retail.",
      },
      {
        path: "on-hand",
        icon: Boxes,
        title: "Inventory on Hand",
        description: "Computed current stock with cost and retail valuation.",
      },
      {
        path: "bottle-keep",
        icon: ClipboardList,
        title: "Bottle Keep & Forfeited Inventory",
        description:
          "Bottles a guest paid for and left behind: who holds what, what has passed its keep date, and what forfeits back to stock at zero cost.",
      },
      {
        path: "blank-forms",
        icon: ClipboardList,
        title: "Blank Entry Forms",
        description:
          "Printable Sales, Purchase, and Non-Revenue forms for filling in by hand, then importing back or scanning with Stocky.",
      },
      {
        path: "count-sheet",
        icon: ClipboardList,
        title: "Physical Count Sheet",
        description:
          "Printable blind sheet for counting the shelf. No expected figures shown, so what's written down is what's there.",
      },
      {
        path: "par-level",
        icon: ClipboardList,
        title: "Par Level",
        description: "Stock vs reorder point, with recent movement and a suggested order.",
      },
      {
        path: "non-moving",
        icon: PackageX,
        title: "Non-Moving Items",
        description: "Items on hand that saw no movement last period, ranked by idle value.",
      },
      {
        path: "expiring-batches",
        // Same conservative call as Sales/Sales-by-Item/Top Sellers/Cost
        // Analysis above: perishability defaults false for Supplies and
        // Asset categories (expiry-date-plan.md), so an Asset-only location
        // has nothing to show here.
        requiresProductTypes: ["Beverage", "Food"],
        icon: AlertTriangle,
        title: "Expiring Batches",
        description: "Every open, dated delivery batch on the shelf, expired first then soonest to expire.",
      },
    ],
  },
  {
    title: "Losses & Returns",
    blurb: "Stock that left without earning revenue, and stock that came back.",
    reports: [
      {
        path: "non-revenue",
        icon: Wine,
        title: "Non-Revenue",
        description: "Spoilage, spillage, trimming, and marketing use, grouped by reason.",
      },
      {
        path: "forfeits",
        requiresProductTypes: ["Beverage"],
        icon: Undo2,
        title: "Forfeited Bottles",
        description: "Returned bottles and their open content, valued at cost and retail.",
      },
      {
        path: "asset-breakage",
        requiresProductTypes: ["Asset"],
        icon: Wrench,
        title: "Asset Breakage",
        description: "Equipment that broke, went missing, or was retired, valued at cost.",
      },
    ],
  },
  {
    title: "Asset",
    blurb: "The equipment register and its Beginning/Ending count.",
    reports: [
      {
        path: "asset-register",
        requiresProductTypes: ["Asset"],
        icon: ClipboardCheck,
        title: "Asset Register",
        description: "Every registered asset: code, condition, status, cost, supplier, and its last note.",
      },
      {
        path: "asset-inventory",
        requiresProductTypes: ["Asset"],
        icon: Boxes,
        title: "Asset Inventory",
        description: "Beginning vs ending count for asset items, with the quantity change.",
      },
    ],
  },
];

/**
 * Full Audit, Legacy Audit, Variance Summary, and Usage Cost carry Variance
 * and the figures that can back-solve it — a STAFF account without
 * `canViewVariance` gets no card for them, same slugs the route guard
 * already blocks by URL (`components/app-shell.tsx` `VARIANCE_GATED_REPORTS`,
 * hide-variance-from-staff Phase 4.1/4.2/4.3), so a card can never open onto
 * that guard's "isn't part of your access" screen. Kept as its own list here
 * for the same reason the route guard keeps its own copy rather than
 * importing one: a display-layer mirror of the server's real enforcement
 * (routes/reports.ts Phase 2.2), not something that needs a shared import to
 * stay correct. `full-audit` also covers the "Variance Report" card below
 * (`full-audit?variance=only` shares the base slug, same as every other gate
 * on this page) and the standalone Full Audit link at the top of the page.
 *
 * Usage Cost added post-launch (verification gap): its report is a straight
 * per-item `usage` breakdown off the reconciliation — the same figure Par
 * Level's column was trimmed for — and was missed on the first pass.
 */
const VARIANCE_GATED_REPORTS = ["full-audit", "legacy-audit", "variance-summary", "usage-cost"];

export function ReportsPage() {
  const locationId = useLocationId();
  const href = (path: string) => `/l/${locationId}/reports/${path}`;

  // Audit-service viewers get the reconciliation set only — the same list the
  // server enforces, read from one declaration so the hub can never offer a
  // card that 404s. Everyone running the establishment sees all of them.
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  // Hide variance from staff (hide-variance-from-staff-plan.md, Phase 5.1): a
  // STAFF account without `canViewVariance` loses the Full Audit, Legacy
  // Audit, Variance Summary, and Usage Cost cards entirely — `false` while
  // `me` is still loading, same fallback every other role check on this page
  // already makes.
  const varianceBlocked = me.data ? me.data.user.role === "STAFF" && !canViewVariance(me.data.user) : false;
  // Four filters, same mechanism, all independent — a report needs to clear
  // every one of them to show a card. Role: an audit-service viewer reads the
  // reconciliation and nothing else. Module: an Asset-only warehouse has no use
  // for "Sales by Item (Shot & Bottle)", and the hub was offering all nineteen
  // regardless — every irrelevant one opening to an empty table. Tier: the
  // client's subscription may not include this report at all
  // (docs/2026-08-04-report-tier-gating-plan.md) — mirrors the server's
  // canViewReportForSubscription() so nothing shows a card that then 404s.
  // Variance: a blocked STAFF account loses the reconciliation cards above,
  // same as it loses the URL by hand (VARIANCE_GATED_REPORTS above).
  const location = useCurrentLocation();
  const allowedTypes = allowedProductTypes(location?.modules);
  const client = useCurrentClient();
  const enabledReportSlugs = client?.subscription?.reports ?? [];
  const sections = SECTIONS.map((section) => ({
    ...section,
    reports: section.reports.filter((r) => {
      const slug = r.path.split("?")[0]!;
      return (
        canViewReport(role, slug) &&
        canViewReportForSubscription(role, slug, enabledReportSlugs) &&
        (!r.requiresProductTypes || !allowedTypes || r.requiresProductTypes.some((t) => allowedTypes.includes(t))) &&
        !(varianceBlocked && VARIANCE_GATED_REPORTS.includes(slug))
      );
    }),
  })).filter((section) => section.reports.length > 0);

  // Section headers exist to make nineteen reports findable. Below a handful
  // they stop earning their space and start looking odd — an audit viewer saw a
  // "Sales & Revenue" heading over a single card. Small set, one flat grid.
  const visibleCount = sections.reduce((n, s) => n + s.reports.length, 0);
  const grouped = visibleCount > 6;

  return (
    <div className="space-y-10">
      <div>
        <PageHeader title="Reports" />

        {/* The Full Audit is the report this product exists to produce, so it
            leads the page at its own weight instead of being the first of
            thirteen equals. The formula is why clients trust it. Outside the
            SECTIONS filter above, so it needs its own copy of the variance
            gate: a blocked STAFF account has no more claim to this card than
            to the "Variance Report" one inside Reconciliation. */}
        {!varianceBlocked && (
          <Link to={href("full-audit")} className="group block">
            <Card className="transition-colors group-hover:border-primary/40">
              <CardHeader>
                <BarChart3 className="mb-1 size-5 text-primary" />
                <CardTitle className="text-lg">Full Audit</CardTitle>
                <CardDescription className="max-w-prose">
                  The reconciliation every other report supports: the beginning count and everything
                  that moved, against everything that was sold and used.
                </CardDescription>
                {/* Wraps rather than scrolls: at 375px these lines are 583px
                    wide, and a nested scroller inside a card that is itself a
                    link fights the tap target. A formula reading over two lines
                    is fine; one escaping its card is not. */}
                <div className="mt-3 grid gap-1.5 font-mono text-xs leading-relaxed text-muted-foreground">
                  <span>Begin + Purchases + Returns + Transfers In − Transfers Out − End = Usage</span>
                  <span>(Sales + Recipes + Non-Revenue + Production) − Usage = Variance</span>
                </div>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>

      {grouped ? (
        sections.map((section) => (
          <section key={section.title} className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-medium">{section.title}</h3>
              <p className="text-sm text-muted-foreground">{section.blurb}</p>
            </div>
            <ReportGrid reports={section.reports} href={href} />
          </section>
        ))
      ) : (
        <ReportGrid reports={sections.flatMap((s) => s.reports)} href={href} />
      )}
    </div>
  );
}

function ReportGrid({ reports, href }: { reports: Report[]; href: (path: string) => string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((r) => (
        <Link key={r.path} to={href(r.path)}>
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardHeader>
              <r.icon className="mb-1 size-5 text-primary" />
              <CardTitle className="text-base">{r.title}</CardTitle>
              <CardDescription>{r.description}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
