import { Link, useParams } from "react-router";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  FileInput,
  Receipt,
  ShoppingCart,
  Tags,
  TrendingDown,
} from "lucide-react";
import { round2, type Role, can } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { useDashboard, type DashboardData } from "@/api/dashboard";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const QUICK_ACTIONS = [
  { title: "Start a count", path: "counts", icon: ClipboardList, permission: "entries.create" as const },
  { title: "Receive purchase", path: "purchases", icon: ShoppingCart, permission: "entries.create" as const },
  { title: "Record sale", path: "sales", icon: Receipt, permission: "entries.create" as const },
  { title: "Import a file", path: "imports", icon: FileInput, permission: "imports.upload" as const },
];

export function DashboardPage() {
  const me = useMe();
  const { locationId } = useParams();
  const dash = useDashboard();
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const firstName = me.data?.user.firstName ?? "";
  const actions = QUICK_ACTIONS.filter((a) => can(role, a.permission));
  const to = (path: string) => `/l/${locationId}/${path}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Where this location stands — period status, attention items, and variance leaders.
        </p>
      </div>

      {actions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <Button
              key={action.path}
              asChild
              variant="outline"
              className="h-auto justify-start gap-3 px-4 py-3"
            >
              <Link to={to(action.path)}>
                <action.icon className="size-5 text-primary" />
                <span className="font-medium">{action.title}</span>
              </Link>
            </Button>
          ))}
        </div>
      )}

      {dash.isPending ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40 lg:col-span-1" />
          <Skeleton className="h-40 lg:col-span-2" />
        </div>
      ) : dash.isError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Couldn't load the dashboard</CardTitle>
            <CardDescription>Refresh the page — if it persists, check that the API is running.</CardDescription>
          </CardHeader>
        </Card>
      ) : dash.data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-1">
            <PeriodCard data={dash.data} to={to} />
            <AttentionCard data={dash.data} to={to} role={role} />
          </div>
          <div className="space-y-4 lg:col-span-2">
            <VarianceLeaders data={dash.data} to={to} />
            <RecentActivity data={dash.data} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PeriodCard({ data, to }: { data: DashboardData; to: (p: string) => string }) {
  const { lastCountDate, daysSinceLastCount, countDates, canAudit } = data.period;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" />
          <CardTitle className="text-base">Audit period</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {lastCountDate ? (
          <>
            <div>
              <p className="tnum text-2xl font-semibold tracking-tight">
                {daysSinceLastCount === 0 ? "Today" : `${daysSinceLastCount}d`}
              </p>
              <p className="text-xs text-muted-foreground">
                since the last committed count ({lastCountDate})
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {countDates} committed count {countDates === 1 ? "date" : "dates"} on record.
            </p>
            {canAudit ? (
              <Button asChild size="sm" variant="secondary">
                <Link to={to("reports/full-audit")}>Open Full Audit</Link>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Commit one more count to unlock the Full Audit.
              </p>
            )}
          </>
        ) : (
          <CardDescription>
            No committed counts yet. Start with a beginning count, record the period's activity, then
            count again to generate your first Full Audit.
          </CardDescription>
        )}
      </CardContent>
    </Card>
  );
}

function AttentionCard({
  data,
  to,
  role,
}: {
  data: DashboardData;
  to: (p: string) => string;
  role: Role;
}) {
  const { missingPrices, unmatchedRows, draftPurchases, openCounts } = data.attention;
  const items = [
    {
      show: missingPrices > 0 && can(role, "prices.edit"),
      count: missingPrices,
      label: `item${missingPrices === 1 ? "" : "s"} missing a price`,
      path: "stock",
      icon: Tags,
    },
    {
      show: unmatchedRows > 0,
      count: unmatchedRows,
      label: `import row${unmatchedRows === 1 ? "" : "s"} awaiting review`,
      path: "imports",
      icon: FileInput,
    },
    {
      show: draftPurchases > 0,
      count: draftPurchases,
      label: `purchase draft${draftPurchases === 1 ? "" : "s"} to commit`,
      path: "purchases",
      icon: ShoppingCart,
    },
    {
      show: openCounts > 0,
      count: openCounts,
      label: `count${openCounts === 1 ? "" : "s"} still open`,
      path: "counts",
      icon: ClipboardList,
    },
  ].filter((i) => i.show);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" />
          <CardTitle className="text-base">Needs attention</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">All clear — nothing needs review right now.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i.path}>
                <Link
                  to={to(i.path)}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 -mx-2 transition-colors hover:bg-accent"
                >
                  <i.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">
                    <span className="tnum font-semibold">{i.count}</span> {i.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function VarianceLeaders({ data, to }: { data: DashboardData; to: (p: string) => string }) {
  const leaders = data.varianceLeaders;
  const chartData = leaders.map((l) => ({
    name: l.itemName,
    value: round2(l.varianceCost),
    short: l.short,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <TrendingDown className="size-4 text-primary" />
          <CardTitle className="text-base">Variance leaders</CardTitle>
        </div>
        {data.period.latest && (
          <CardDescription>
            Largest cost swings, {data.period.latest.begin} → {data.period.latest.end}. Red = shortage.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {!data.period.canAudit ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Variance leaders appear once two counts close a period.
          </p>
        ) : leaders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No cost variance in the latest period — the count reconciled cleanly.
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 38)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  formatter={(v) => [formatMoney(Number(v)), "Variance"]}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                  }}
                />
                <Bar dataKey="value" radius={4} barSize={18}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.short ? "var(--destructive)" : "var(--chart-4)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex justify-end">
              <Button asChild size="sm" variant="ghost">
                <Link to={to("reports/full-audit")}>Full Audit →</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity({ data }: { data: DashboardData }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <CardTitle className="text-base">Recent activity</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.recentActivity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y">
            {data.recentActivity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{a.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.userName ?? "System"} · {relativeTime(a.ts)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
