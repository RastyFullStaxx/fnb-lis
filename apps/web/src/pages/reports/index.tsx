import { Link } from "react-router";
import { ArrowLeftRight, BarChart3, Boxes, PieChart, Receipt, ShoppingCart, Wine } from "lucide-react";
import { useLocationId } from "@/api/location";
import { useTrends } from "@/api/dashboard";
import { pesoFull, shortDate } from "@/components/charts/chart-kit";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const REPORTS = [
  {
    path: "full-audit",
    icon: BarChart3,
    title: "Full Audit",
    description: "The reconciliation: beginning count + purchases + returns − ending count vs. what was sold and used.",
  },
  { path: "sales", icon: Receipt, title: "Sales", description: "Revenue and quantities by day, item, and menu." },
  { path: "purchases", icon: ShoppingCart, title: "Purchases", description: "Deliveries by supplier and date with cost totals." },
  { path: "non-revenue", icon: Wine, title: "Non-revenue", description: "Comps, spillage, staff use — grouped by reason." },
  { path: "transfers", icon: ArrowLeftRight, title: "Transfers", description: "Stock sent to and received from this client's other locations, at cost and retail." },
  { path: "cost-analysis", icon: PieChart, title: "Cost Analysis", description: "Beverage and food cost: beginning + purchases − ending, as a share of sales." },
  { path: "on-hand", icon: Boxes, title: "Inventory on hand", description: "Computed current stock with cost and retail valuation." },
];

export function ReportsPage() {
  const locationId = useLocationId();
  // Latest-period pulses for the two headline cards; shares the dashboard's
  // cached query, so the hub costs nothing extra when you arrive from there.
  const trends = useTrends(8);
  const latest = trends.data?.periods.at(-1);

  const pulse = (path: string): { label: string; value: string; negative?: boolean } | null => {
    if (!latest) return null;
    if (path === "full-audit") {
      return {
        label: `Variance ${shortDate(latest.begin)} – ${shortDate(latest.end)}`,
        value: pesoFull(latest.varianceCost),
        negative: latest.varianceCost < 0,
      };
    }
    if (path === "sales") {
      return {
        label: `Sales ${shortDate(latest.begin)} – ${shortDate(latest.end)}`,
        value: pesoFull(latest.revenue),
      };
    }
    return null;
  };

  return (
    <div>
      <PageHeader title="Reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const stat = pulse(r.path);
          return (
            <Link
              key={r.path}
              to={`/l/${locationId}/reports/${r.path}`}
              className="rounded-lg focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <r.icon className="mb-1 size-5 text-primary" />
                  <CardTitle className="text-base">{r.title}</CardTitle>
                  <CardDescription>{r.description}</CardDescription>
                  {stat ? (
                    <div className="mt-2 border-t pt-2">
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                      <p className={cn("tnum mt-0.5 text-sm font-semibold", stat.negative && "text-destructive")}>
                        {stat.value}
                      </p>
                    </div>
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
