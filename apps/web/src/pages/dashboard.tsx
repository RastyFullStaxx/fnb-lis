import { Link, useParams } from "react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Circle,
  ClipboardList,
  FileInput,
  Package,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Tags,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { can, type Permission, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useDashboard, useTrends, type DashboardData, type TrendPeriod } from "@/api/dashboard";
import { formatMoney } from "@/lib/utils";
import { pesoCompact, pesoFull, shortDate } from "@/components/charts/chart-kit";
import { PeriodColumns } from "@/components/charts/period-columns";
import { StatTile, type StatTileDelta } from "@/components/charts/stat-tile";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ActionKind = "count" | "import" | "purchase" | "items" | "prices" | "audit" | "sale" | "stock";

interface DashboardAction {
  kind: ActionKind;
  title: string;
  description: string;
  buttonLabel: string;
  path: string;
  icon: LucideIcon;
}

interface SecondaryAction {
  kind: ActionKind;
  title: string;
  path: string;
  icon: LucideIcon;
  permission: Permission;
}

const SECONDARY_ACTIONS: SecondaryAction[] = [
  { kind: "purchase", title: "Receive Delivery", path: "purchases", icon: ShoppingCart, permission: "entries.create" },
  { kind: "sale", title: "Record Sale", path: "sales", icon: Receipt, permission: "entries.create" },
  { kind: "import", title: "Import File", path: "imports", icon: FileInput, permission: "imports.upload" },
];

const DATE = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function DashboardPage() {
  const me = useMe();
  const { locationId } = useParams();
  const dash = useDashboard();
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const firstName = me.data?.user.firstName ?? "";
  const to = (path: string) => `/l/${locationId}/${path}`;

  return (
    <div>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ""}`} />

      {dash.isPending ? (
        <DashboardSkeleton />
      ) : dash.isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div>
              <h2 className="text-base font-semibold">Could not load the dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We could not reach the inventory service. Check your connection and try again.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void dash.refetch()}
              disabled={dash.isRefetching}
            >
              <RefreshCw className={dash.isRefetching ? "size-4 animate-spin" : "size-4"} />
              {dash.isRefetching ? "Retrying…" : "Try again"}
            </Button>
          </CardContent>
        </Card>
      ) : dash.data ? (
        <DashboardContent data={dash.data} role={role} to={to} />
      ) : null}
    </div>
  );
}

function DashboardContent({
  data,
  role,
  to,
}: {
  data: DashboardData;
  role: Role;
  to: (path: string) => string;
}) {
  const stage = getStage(data);
  const unresolved = unresolvedCount(data);
  const primary = getPrimaryAction(data, role);
  const secondary = SECONDARY_ACTIONS.filter(
    (action) => can(role, action.permission) && action.kind !== primary.kind,
  );

  return (
    <div className="space-y-6">
      <OperationalStatus data={data} stage={stage} unresolved={unresolved} />

      <Card>
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]">
          <NextAction action={primary} secondary={secondary} data={data} to={to} role={role} />
          <AttentionQueue data={data} role={role} to={to} />
        </CardContent>
      </Card>

      {data.period.canAudit ? <TrendsBand /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
        {stage === "SETUP" ? (
          <SetupChecklist data={data} role={role} to={to} />
        ) : (
          <VarianceLeaders data={data} to={to} />
        )}
        <RecentActivity data={data} role={role} to={to} />
      </div>
    </div>
  );
}

type DashboardStage = "SETUP" | "COUNTING" | "ACTIVE" | "RECONCILIATION";

function getStage(data: DashboardData): DashboardStage {
  if (data.openWork.latestCount) return "COUNTING";
  if (data.readiness.activeItems === 0 || data.period.countDates === 0) return "SETUP";
  if (data.period.canAudit) return "RECONCILIATION";
  return "ACTIVE";
}

function getPrimaryAction(data: DashboardData, role: Role): DashboardAction {
  const openCount = data.openWork.latestCount;
  if (openCount && can(role, "entries.create")) {
    return {
      kind: "count",
      title: "Continue the Open Count",
      description: `${formatDate(openCount.date)} has ${openCount.lineCount} ${openCount.lineCount === 1 ? "entry" : "entries"} saved. Resume where the team left off.`,
      buttonLabel: "Continue Count",
      path: `counts/${openCount.id}`,
      icon: ClipboardList,
    };
  }
  if (data.attention.unmatchedRows > 0 && can(role, "imports.upload")) {
    return {
      kind: "import",
      title: "Review Imported Rows",
      description: `${data.attention.unmatchedRows} ${data.attention.unmatchedRows === 1 ? "row needs" : "rows need"} a match before the import can be committed.`,
      buttonLabel: "Review Import",
      path: "imports",
      icon: FileInput,
    };
  }
  const purchase = data.openWork.latestPurchase;
  if (purchase && can(role, "entries.create")) {
    const reference = purchase.invoiceRef ? `Invoice ${purchase.invoiceRef}` : "The latest delivery draft";
    return {
      kind: "purchase",
      title: "Continue the Delivery Draft",
      description: `${reference}${purchase.supplierName ? ` from ${purchase.supplierName}` : ""} is waiting to be committed.`,
      buttonLabel: "Continue Delivery",
      path: `purchases/${purchase.id}`,
      icon: ShoppingCart,
    };
  }
  if (data.readiness.activeItems === 0 && can(role, "master.write")) {
    return {
      kind: "items",
      title: "Add the First Inventory Item",
      description: "Build the location catalog before recording counts, deliveries, or sales.",
      buttonLabel: "Add Inventory Items",
      path: "items",
      icon: Package,
    };
  }
  if (data.period.countDates === 0 && can(role, "entries.create")) {
    return {
      kind: "count",
      title: "Start the Beginning Count",
      description: "Commit the location's opening quantities to establish the first audit period.",
      buttonLabel: "Start Beginning Count",
      path: "counts",
      icon: ClipboardList,
    };
  }
  if (data.attention.missingPrices > 0 && can(role, "prices.edit")) {
    return {
      kind: "prices",
      title: "Complete Missing Prices",
      description: `${data.attention.missingPrices} ${data.attention.missingPrices === 1 ? "item needs" : "items need"} cost or retail pricing before reports are complete.`,
      buttonLabel: "Complete Pricing",
      path: "stock",
      icon: Tags,
    };
  }
  if (data.period.canAudit && can(role, "reports.view")) {
    return {
      kind: "audit",
      title: "Review the Latest Reconciliation",
      description: data.period.latest
        ? `${formatDate(data.period.latest.begin)} to ${formatDate(data.period.latest.end)} is ready for variance review.`
        : "The latest count pair is ready for variance review.",
      buttonLabel: "Open Full Audit",
      path: "reports/full-audit",
      icon: TrendingDown,
    };
  }
  if (can(role, "entries.create")) {
    return {
      kind: "count",
      title: "Start the Next Count",
      description: "Record the next physical count to close the current activity period.",
      buttonLabel: "Start a Count",
      path: "counts",
      icon: ClipboardList,
    };
  }
  if (can(role, "reports.view")) {
    return {
      kind: "audit",
      title: "Review Inventory Reports",
      description: "Open the report library to review stock, purchases, sales, and audit history.",
      buttonLabel: "View Reports",
      path: "reports",
      icon: TrendingDown,
    };
  }
  return {
    kind: "stock",
    title: "Review Current Stock",
    description: "Open the stock list to review the active catalog for this location.",
    buttonLabel: "View Stock",
    path: "stock",
    icon: Package,
  };
}

/**
 * Audit trends: how the location is doing ACROSS periods — revenue and
 * variance per closed audit window, with headline tiles for the latest one.
 * Complements Variance leaders (item-level, latest period) with the
 * period-level story: "are we getting better?"
 */
function TrendsBand() {
  const trends = useTrends(8);

  if (trends.isPending) {
    return <Skeleton className="h-72" aria-label="Loading audit trends" />;
  }
  // Trends are supplementary — a load failure here shouldn't shout on the
  // dashboard; the strip and leaders still carry the day-to-day story.
  if (trends.isError || !trends.data || trends.data.periods.length < 2) return null;

  const periods = trends.data.periods;
  const latest = periods[periods.length - 1]!;
  const prior = periods[periods.length - 2]!;

  const revenueDelta = tileDelta(latest.revenue, prior.revenue, true);
  // For variance, "better" means closer to zero — direction follows the raw
  // move, goodness follows the magnitude.
  const varianceDelta = tileDelta(latest.varianceCost, prior.varianceCost, null);
  if (varianceDelta) varianceDelta.good = Math.abs(latest.varianceCost) < Math.abs(prior.varianceCost);

  const varianceVsSales =
    latest.revenue > 0 ? (latest.varianceRetail / latest.revenue) * 100 : null;
  const priorVarianceVsSales =
    prior.revenue > 0 ? (prior.varianceRetail / prior.revenue) * 100 : null;

  const columns = (value: (p: TrendPeriod) => number) =>
    periods.map((p) => ({
      label: shortDate(p.end),
      value: value(p),
      tooltipLabel: `${shortDate(p.begin)} – ${shortDate(p.end)}`,
    }));

  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="size-4 text-primary" />
            <h2 className="text-base font-semibold">Audit Trends</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Last {periods.length} closed {periods.length === 1 ? "period" : "periods"}
          </p>
        </div>

        <div className="mt-5 grid gap-6 border-b pb-5 sm:grid-cols-3">
          <StatTile
            label="Latest period sales"
            value={pesoFull(latest.revenue)}
            delta={revenueDelta ?? undefined}
            spark={periods.map((p) => p.revenue)}
          />
          <StatTile
            label="Latest period variance (cost)"
            value={pesoFull(latest.varianceCost)}
            valueClassName={latest.varianceCost < 0 ? "text-destructive" : undefined}
            delta={varianceDelta ?? undefined}
            spark={periods.map((p) => p.varianceCost)}
          />
          <StatTile
            label="Variance vs sales (retail)"
            value={varianceVsSales === null ? "—" : `${varianceVsSales.toFixed(1)}%`}
            valueClassName={varianceVsSales !== null && varianceVsSales < 0 ? "text-destructive" : undefined}
            delta={
              // No delta for a move that rounds to 0.0 pts — an unchanged
              // (often perfectly clean) ratio must never wear red.
              varianceVsSales !== null &&
              priorVarianceVsSales !== null &&
              Math.abs(varianceVsSales - priorVarianceVsSales) >= 0.05
                ? {
                    text: `${Math.abs(varianceVsSales - priorVarianceVsSales).toFixed(1)} pts`,
                    direction: varianceVsSales > priorVarianceVsSales ? "up" : "down",
                    good: Math.abs(varianceVsSales) < Math.abs(priorVarianceVsSales),
                    vs: "vs prior period",
                  }
                : undefined
            }
            detail={varianceVsSales === null ? "No sales in the latest period" : undefined}
          />
        </div>

        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          <section aria-label="Sales by audit period">
            <h3 className="text-sm font-semibold">Sales by Period</h3>
            <div className="mt-3">
              <PeriodColumns data={columns((p) => p.revenue)} name="Sales" height={200} />
            </div>
          </section>
          <section aria-label="Variance by audit period">
            <h3 className="text-sm font-semibold">Variance by Period (Cost)</h3>
            <div className="mt-3">
              <PeriodColumns data={columns((p) => p.varianceCost)} name="Variance" diverging height={200} />
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

/** Signed compact delta vs the prior period; null when there's no move —
    including moves that would ROUND to zero ("+₱0" with an arrow is a lie). */
function tileDelta(latest: number, prior: number, upIsGood: boolean | null): StatTileDelta | null {
  const diff = latest - prior;
  if (Math.abs(diff) < 0.5) return null;
  return {
    text: `${diff > 0 ? "+" : ""}${pesoCompact(diff)}`,
    direction: diff > 0 ? "up" : "down",
    good: upIsGood === null ? null : diff > 0 === upIsGood,
    vs: "vs prior period",
  };
}

function OperationalStatus({
  data,
  stage,
  unresolved,
}: {
  data: DashboardData;
  stage: DashboardStage;
  unresolved: number;
}) {
  const stageCopy: Record<DashboardStage, { label: string; detail: string }> = {
    SETUP: { label: "Setup", detail: "Prepare the first audit period" },
    COUNTING: { label: "Counting", detail: "A physical count is in progress" },
    ACTIVE: { label: "Active Period", detail: "Record activity before the next count" },
    RECONCILIATION: { label: "Reconciliation Ready", detail: "A count pair is ready to review" },
  };

  return (
    <section aria-label="Operational status" className="border-y bg-muted/35 px-4 py-4 sm:px-5">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatusItem label="Audit stage" value={stageCopy[stage].label} detail={stageCopy[stage].detail} />
        <StatusItem
          label="Latest committed count"
          value={data.period.lastCountDate ? formatDate(data.period.lastCountDate) : "Not started"}
          detail={
            data.period.daysSinceLastCount === null
              ? "No committed count yet"
              : data.period.daysSinceLastCount === 0
                ? "Committed today"
                : `${data.period.daysSinceLastCount} days ago`
          }
        />
        <StatusItem
          label="Latest auditable period"
          value={
            data.period.latest
              ? `${formatDate(data.period.latest.begin)} to ${formatDate(data.period.latest.end)}`
              : "Not available"
          }
          detail={data.period.canAudit ? "Full Audit available" : "Two committed dates required"}
        />
        <StatusItem
          label="Unresolved work"
          value={`${unresolved} ${unresolved === 1 ? "item" : "items"}`}
          detail={`Updated ${relativeTime(data.generatedAt)}`}
        />
      </div>
    </section>
  );
}

function StatusItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tnum" title={value}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function NextAction({
  action,
  secondary,
  data,
  to,
  role,
}: {
  action: DashboardAction;
  secondary: SecondaryAction[];
  data: DashboardData;
  to: (path: string) => string;
  role: Role;
}) {
  return (
    <section aria-labelledby="next-action-heading">
      <div className="flex items-center gap-2 text-primary">
        <action.icon className="size-4" />
        <h2 id="next-action-heading" className="text-sm font-semibold text-foreground">Next Action</h2>
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{action.title}</h3>
      <p className="mt-1 max-w-[60ch] text-sm leading-6 text-muted-foreground">{action.description}</p>
      <Button asChild className="mt-5">
        <Link to={to(action.path)}>
          {action.buttonLabel}
          <ArrowRight className="size-4" />
        </Link>
      </Button>

      {secondary.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4" aria-label="Other common actions">
          {secondary.map((item) => (
            <Button key={item.kind} asChild size="sm" variant="ghost" className="text-muted-foreground">
              <Link to={to(item.path)}>
                <item.icon className="size-4" />
                {item.title}
              </Link>
            </Button>
          ))}
        </div>
      ) : null}

      {/* Only worth mentioning to people who can actually continue the draft. */}
      {data.openWork.latestPurchase && action.kind !== "purchase" && can(role, "entries.create") ? (
        <p className="mt-3 text-xs text-muted-foreground">
          A delivery draft was last updated {relativeTime(data.openWork.latestPurchase.updatedAt)}.
        </p>
      ) : null}
    </section>
  );
}

function AttentionQueue({
  data,
  role,
  to,
}: {
  data: DashboardData;
  role: Role;
  to: (path: string) => string;
}) {
  const items = attentionItems(data, role);
  const unresolved = unresolvedCount(data);
  const allClear = data.readiness.activeItems > 0 && data.period.countDates > 0 && unresolved === 0;

  return (
    <section aria-labelledby="attention-heading" className="border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
      <div className="flex items-center gap-2">
        {items.length > 0 ? (
          <AlertTriangle className="size-4 text-warning" />
        ) : (
          <Check className="size-4 text-muted-foreground" />
        )}
        <h2 id="attention-heading" className="text-sm font-semibold">Needs Attention</h2>
      </div>

      {items.length > 0 ? (
        <ul className="mt-4 space-y-1">
          {items.map((item) => (
            <li key={item.kind}>
              <Link
                to={to(item.path)}
                className="group flex min-h-10 items-center gap-3 rounded-md px-2 py-2 -mx-2 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <item.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-sm">{item.label}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      ) : allClear ? (
        <div className="mt-4 flex gap-3 rounded-md bg-success/10 p-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-success-text" />
          <p>No pricing, import, delivery, or count work needs review right now.</p>
        </div>
      ) : data.readiness.activeItems === 0 || data.period.countDates === 0 ? (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Finish the location setup first.
        </p>
      ) : (
        // Setup is done and the remaining unresolved work belongs to another
        // role — don't tell a viewer to "finish setup" they can't touch.
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Nothing here needs your attention right now.
        </p>
      )}

      {unresolved > items.reduce((total, item) => total + item.count, 0) ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Some unresolved work requires a manager to complete.
        </p>
      ) : null}
    </section>
  );
}

interface AttentionItem {
  kind: ActionKind;
  count: number;
  label: string;
  path: string;
  icon: LucideIcon;
}

function attentionItems(data: DashboardData, role: Role): AttentionItem[] {
  const { missingPrices, unmatchedRows, draftPurchases, openCounts } = data.attention;
  const items: Array<AttentionItem | null> = [
    missingPrices > 0 && can(role, "prices.edit")
      ? { kind: "prices", count: missingPrices, label: `Complete pricing for ${missingPrices} ${missingPrices === 1 ? "item" : "items"}`, path: "stock", icon: Tags }
      : null,
    unmatchedRows > 0 && can(role, "imports.upload")
      ? { kind: "import", count: unmatchedRows, label: `Review ${unmatchedRows} unmatched import ${unmatchedRows === 1 ? "row" : "rows"}`, path: "imports", icon: FileInput }
      : null,
    draftPurchases > 0 && can(role, "entries.create")
      ? { kind: "purchase", count: draftPurchases, label: `Continue ${draftPurchases} delivery ${draftPurchases === 1 ? "draft" : "drafts"}`, path: "purchases", icon: ShoppingCart }
      : null,
    openCounts > 0 && can(role, "entries.create")
      ? { kind: "count", count: openCounts, label: `Continue ${openCounts} open ${openCounts === 1 ? "count" : "counts"}`, path: "counts", icon: ClipboardList }
      : null,
  ];
  return items.filter((item): item is AttentionItem => item !== null);
}

function SetupChecklist({
  data,
  role,
  to,
}: {
  data: DashboardData;
  role: Role;
  to: (path: string) => string;
}) {
  const steps = [
    {
      title: "Add Inventory Items",
      detail: data.readiness.activeItems > 0 ? `${data.readiness.activeItems} active items available` : "Create the location catalog",
      done: data.readiness.activeItems > 0,
      path: "items",
      actionable: can(role, "master.write"),
    },
    {
      title: "Complete Item Pricing",
      detail: data.readiness.activeItems === 0
        ? "Add items before assigning prices"
        : data.attention.missingPrices === 0
          ? "All active items have cost and retail prices"
          : `${data.attention.missingPrices} ${data.attention.missingPrices === 1 ? "item needs" : "items need"} pricing`,
      done: data.readiness.activeItems > 0 && data.attention.missingPrices === 0,
      path: "stock",
      actionable: can(role, "prices.edit"),
    },
    {
      title: "Commit the Beginning Count",
      detail: data.period.countDates > 0 ? "The first audit period is active" : "Record the opening quantities",
      done: data.period.countDates > 0,
      path: "counts",
      actionable: can(role, "entries.create"),
    },
  ];

  return (
    <Card>
      <CardContent>
        <h2 className="text-base font-semibold">Finish Location Setup</h2>
        <ol className="mt-5 space-y-4">
          {steps.map((step) => (
            <li key={step.title} className="flex gap-3">
              {step.done ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-success-text" aria-label="Complete">
                  <Check className="size-3.5" />
                </span>
              ) : (
                <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground" aria-label="Not complete">
                  <Circle className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
              </div>
              {!step.done && step.actionable ? (
                <Button asChild size="sm" variant="ghost">
                  <Link to={to(step.path)}>Open</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function VarianceLeaders({ data, to }: { data: DashboardData; to: (path: string) => string }) {
  const leaders = data.varianceLeaders;
  const maxMagnitude = Math.max(1, ...leaders.map((item) => Math.abs(item.varianceCost)));

  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingDown className="size-4 text-primary" />
              <h2 className="text-base font-semibold">Variance Leaders</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.period.latest
                ? `${formatDate(data.period.latest.begin)} to ${formatDate(data.period.latest.end)}, ranked by cost impact.`
                : "Items with the largest cost impact in the latest period."}
            </p>
          </div>
          {data.period.canAudit ? (
            <Button asChild size="sm" variant="ghost">
              <Link to={to("reports/full-audit")}>Open Full Audit</Link>
            </Button>
          ) : null}
        </div>

        {!data.period.canAudit ? (
          <p className="py-8 text-sm text-muted-foreground">
            Commit a second count date to reveal the first period's variance.
          </p>
        ) : leaders.length === 0 ? (
          <div className="mt-5 rounded-md bg-success/10 p-4 text-sm">
            The latest period has no cost variance. Open the Full Audit to review the source records.
          </div>
        ) : (
          <ol className="mt-4 divide-y" aria-label="Items ranked by absolute cost variance">
            {leaders.map((item) => {
              const width = `${Math.max(4, Math.abs(item.varianceCost) / maxMagnitude * 100)}%`;
              return (
                <li key={item.locationItemId}>
                  <Link
                    to={to(`reports/full-audit?drill=${item.locationItemId}`)}
                    className="group grid gap-3 rounded-md px-2 py-3 -mx-2 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"
                    aria-label={`Open ${item.itemName} in the Full Audit`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" title={item.itemName}>{item.itemName}</p>
                      <div className="mt-2 h-1 max-w-72 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div
                          className={item.short ? "h-full rounded-full bg-destructive" : "h-full rounded-full bg-primary"}
                          style={{ width }}
                        />
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className={item.short ? "text-xs font-medium text-destructive" : "text-xs font-medium text-primary"}>
                        {item.short ? "Shortage" : "Surplus"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground tnum">
                        {item.variancePct === null ? "Percentage n/a" : `${Math.abs(item.variancePct).toFixed(1)}%`}
                      </p>
                    </div>
                    <div className="text-left sm:min-w-32 sm:text-right">
                      <p className="text-sm font-semibold tnum">{formatMoney(item.varianceCost)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground tnum">Retail {formatMoney(item.varianceRetail)}</p>
                    </div>
                    <ArrowRight className="hidden size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 sm:block" />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity({
  data,
  role,
  to,
}: {
  data: DashboardData;
  role: Role;
  to: (path: string) => string;
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h2 className="text-base font-semibold">Recent Activity</h2>
          </div>
          {can(role, "activity.view") ? (
            <Button asChild size="sm" variant="ghost">
              <Link to={to("admin/activity")}>View Activity</Link>
            </Button>
          ) : null}
        </div>

        {data.recentActivity.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">
            No activity has been recorded for this location yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y">
            {data.recentActivity.map((item) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <p className="line-clamp-2 text-sm">{item.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.userName ?? "System"} <span aria-hidden="true">·</span> {relativeTime(item.ts)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading dashboard">
      <Skeleton className="h-[104px] rounded-none" />
      <Skeleton className="h-56" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function unresolvedCount(data: DashboardData): number {
  return data.attention.missingPrices
    + data.attention.unmatchedRows
    + data.attention.draftPurchases
    + data.attention.openCounts;
}

function formatDate(date: string): string {
  return DATE.format(new Date(`${date}T00:00:00`));
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
