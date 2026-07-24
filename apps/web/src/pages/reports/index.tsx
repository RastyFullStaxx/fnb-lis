import { Link } from "react-router";
import {
  ArrowLeftRight,
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

type Report = { path: string; icon: LucideIcon; title: string; description: string };

/**
 * Thirteen reports in one flat grid meant reading every description to find
 * one. They group by the question being asked, in the order an audit is
 * actually worked: reconcile the period, explain it through sales, trace the
 * stock that moved, then account for what was written off.
 */
const SECTIONS: Array<{ title: string; blurb: string; reports: Report[] }> = [
  {
    title: "Reconciliation",
    blurb: "Count to count — what should have been used, against what was.",
    reports: [
      {
        path: "full-audit?variance=only",
        icon: BarChart3,
        title: "Variance Report",
        description: "Only the items that missed or beat expectation, at cost and retail.",
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
        description: "Counted stock on an audit date, valued on the client's cost basis.",
      },
    ],
  },
  {
    title: "Sales & Revenue",
    blurb: "What was sold, how it was poured, and what it cost to sell.",
    reports: [
      {
        path: "sales",
        icon: Receipt,
        title: "Sales",
        description: "Revenue and quantities by day, item, and menu — with Discounted and Production views.",
      },
      {
        path: "sales-by-item",
        icon: GlassWater,
        title: "Sales by Item (Shot & Bottle)",
        description: "Per-item shot and bottle sales for an audit period, with cost of sold and revenue.",
      },
      {
        path: "top-sellers",
        icon: TrendingUp,
        title: "Top Sellers",
        description: "Best-selling items, menus, and ingredients by quantity or revenue.",
      },
      {
        path: "cost-analysis",
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
        description: "Stock sent to and received from this client's other locations, at cost and retail.",
      },
      {
        path: "on-hand",
        icon: Boxes,
        title: "Inventory on Hand",
        description: "Computed current stock with cost and retail valuation.",
      },
      {
        path: "par-level",
        icon: ClipboardList,
        title: "Par Level",
        description: "Stock vs reorder point, with recent movement and a suggested order — a purchasing guide.",
      },
      {
        path: "non-moving",
        icon: PackageX,
        title: "Non-Moving Items",
        description: "Dead stock — items on hand that saw no movement last period, ranked by idle value.",
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
        description: "Spoilage & spillages, trimming, marketing — grouped by reason.",
      },
      {
        path: "forfeits",
        icon: Undo2,
        title: "Forfeited Bottles",
        description: "Returned bottles and their open content, valued at cost and retail.",
      },
      {
        path: "asset-breakage",
        icon: Wrench,
        title: "Asset Breakage",
        description: "Equipment that broke, went missing, or was retired — what happened, valued at cost. (Asset locations.)",
      },
    ],
  },
  {
    title: "Asset",
    blurb: "The equipment register and its Beginning/Ending count. (Asset locations.)",
    reports: [
      {
        path: "asset-register",
        icon: ClipboardCheck,
        title: "Asset Register",
        description: "Every registered asset — code, condition, status, cost, supplier, and its last note.",
      },
      {
        path: "asset-inventory",
        icon: Boxes,
        title: "Asset Inventory",
        description: "Beginning vs Ending count for asset items, with the quantity change.",
      },
    ],
  },
];

export function ReportsPage() {
  const locationId = useLocationId();
  const href = (path: string) => `/l/${locationId}/reports/${path}`;

  return (
    <div className="space-y-10">
      <div>
        <PageHeader title="Reports" />

        {/* The Full Audit is the report this product exists to produce, so it
            leads the page at its own weight instead of being the first of
            thirteen equals. The formula is why clients trust it. */}
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
      </div>

      {SECTIONS.map((section) => (
        <section key={section.title} className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-medium">{section.title}</h3>
            <p className="text-sm text-muted-foreground">{section.blurb}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.reports.map((r) => (
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
        </section>
      ))}
    </div>
  );
}
