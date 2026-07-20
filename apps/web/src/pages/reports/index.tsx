import { Link } from "react-router";
import { ArrowLeftRight, BarChart3, Boxes, PieChart, Receipt, ShoppingCart, TrendingUp, Wine } from "lucide-react";
import { useLocationId } from "@/api/location";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const REPORTS = [
  {
    path: "full-audit",
    icon: BarChart3,
    title: "Full Audit",
    description: "The reconciliation: beginning count + purchases + returns − ending count vs. what was sold and used.",
    ready: true,
  },
  { path: "sales", icon: Receipt, title: "Sales", description: "Revenue and quantities by day, item, and menu — with Discounted and Production views.", ready: true },
  { path: "purchases", icon: ShoppingCart, title: "Purchases", description: "Deliveries by supplier and date with cost totals.", ready: true },
  { path: "non-revenue", icon: Wine, title: "Non-Revenue", description: "Spoilage & spillages, trimming, marketing — grouped by reason.", ready: true },
  { path: "transfers", icon: ArrowLeftRight, title: "Transfers (Requisition)", description: "Stock sent to and received from this client's other locations, at cost and retail.", ready: true },
  { path: "cost-analysis", icon: PieChart, title: "Cost Analysis", description: "Beverage and food cost: beginning + purchases − ending, as a share of sales.", ready: true },
  { path: "on-hand", icon: Boxes, title: "Inventory on Hand", description: "Computed current stock with cost and retail valuation.", ready: true },
  { path: "top-sellers", icon: TrendingUp, title: "Top Sellers", description: "Best-selling items, menus, and ingredients by quantity or revenue.", ready: true },
  {
    path: "full-audit?variance=only",
    icon: BarChart3,
    title: "Variance Report",
    description: "Only the items that missed or beat expectation, at cost and retail.",
    ready: true,
  },
];

export function ReportsPage() {
  const locationId = useLocationId();
  return (
    <div>
      <PageHeader title="Reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) =>
          r.ready ? (
            <Link key={r.path} to={`/l/${locationId}/reports/${r.path}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <r.icon className="mb-1 size-5 text-primary" />
                  <CardTitle className="text-base">{r.title}</CardTitle>
                  <CardDescription>{r.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ) : (
            <Card key={r.path} className="h-full opacity-60">
              <CardHeader>
                <r.icon className="mb-1 size-5 text-muted-foreground" />
                <CardTitle className="flex items-center gap-2 text-base">
                  {r.title}
                  <Badge variant="outline">Phase 5</Badge>
                </CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}
