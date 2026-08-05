import { useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { Check, ChevronsUpDown, Lock, LogOut, Sparkles } from "lucide-react";
import { can, canViewReport, canViewReportForSubscription, LOCATION_KIND_LABELS, type LocationKind, type MeResponse, type Role } from "@fnb/core";
import { useLogout, useMe } from "@/api/auth";
import { ApiError } from "@/api/http";
import { BootError, BootSkeleton } from "@/components/full-page-spinner";
import { ADMIN_NAV, CATALOG_NAV, MAIN_NAV, permissionForPath, visibleNav, type NavItem } from "@/lib/nav";
import { EmptyState } from "@/components/empty-state";
import { useCurrentClient } from "@/api/location";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/command-palette";
import { ReadonlyWatermark } from "@/components/readonly-watermark";
import { StockySheet } from "@/components/stocky/stocky-sheet";
import { NotificationMenu } from "@/components/notification-menu";
import { TopProgress } from "@/components/top-progress";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import lisLogo from "@/assets/lis-logo.png";

export function AppShell() {
  const me = useMe();
  const { locationId } = useParams();

  // A PAUSED query is still `pending`, so this order matters: treat it as a
  // reachability failure, not as loading, or the shell shows a skeleton with no
  // error and no retry for as long as the pause lasts.
  //
  // `document.hasFocus()` is load-bearing. A retry pauses whenever the window
  // is in the background — query-core's `canContinue()` requires
  // `focusManager.isFocused()` regardless of networkMode — so without the guard
  // this fired on anyone who tabbed away mid-load and came back to "can't reach
  // the inventory service" for a service that was fine. See main.tsx.
  if (me.fetchStatus === "paused" && document.hasFocus()) {
    return (
      <BootError
        message="Can't reach the inventory service. Check your connection, then reload."
        // Deliberately a reload, not `me.refetch()`. A refetch re-enters the
        // same retryer and pauses again on the same condition; a fresh document
        // is focused by definition, so the reload provably clears it.
        onRetry={() => window.location.reload()}
      />
    );
  }
  if (me.isPending) return <BootSkeleton />;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      // ?expired=1 → the login page shows a calm "session ended" notice
      // instead of looking like the user was silently kicked out.
      return <Navigate to="/login?expired=1" replace />;
    }
    return (
      <BootError
        message="Could not reach the inventory service. Check your connection and try again."
        onRetry={() => void me.refetch()}
      />
    );
  }

  const allLocations = me.data.clients.flatMap((c) =>
    c.locations.map((l) => ({ ...l, clientName: c.name })),
  );
  const current = allLocations.find((l) => l.id === locationId);
  if (!current) {
    const first = allLocations[0];
    return first ? <Navigate to={`/l/${first.id}/dashboard`} replace /> : (
      <BootError message="Your account has no assigned client locations yet. Ask your administrator to grant access." />
    );
  }

  return <ShellLayout me={me.data} current={current} />;
}

interface CurrentLocation {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  modules: string[];
}

function ShellLayout({ me, current }: { me: MeResponse; current: CurrentLocation }) {
  const role = me.user.role;
  // Fix Plan §2.3: nav visibility is gated by THIS location's own modules
  // (the enforced reality), not the client's whole subscription ceiling —
  // a Bar-only location shouldn't see Recipes built from Kitchen items just
  // because its client also operates a separate Kitchen location.
  const locationModules = current.modules;
  const mainNav = visibleNav(MAIN_NAV, role, locationModules);
  const catalogNav = visibleNav(CATALOG_NAV, role, locationModules);
  const adminNav = visibleNav(ADMIN_NAV, role, locationModules);

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen()}>
      {/* First element in the tree on purpose: a skip link that is not the
          first tab stop is decoration. It previously sat inside SidebarInset,
          which the whole sidebar precedes in DOM order, so Tab reached it only
          after the seventeen links it exists to skip. */}
      {/* First element in the tree: a skip link that is not the first tab stop
          is decoration. Styling lives in `.skip-link` (index.css) — the plain
          `:focus` rule every site uses, rather than Tailwind's
          `sr-only`/`focus:not-sr-only` pair, which left `clip-path: inset(50%)`
          applied while focused. */}
      <a href="#page-content" className="skip-link">
        Skip to content
      </a>
      <TopProgress />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <LocationSwitcher me={me} current={current} />
        </SidebarHeader>
        {/* gap-0 + tightened groups: the full admin nav (3 groups, 14 items)
            must fit a 13" laptop (~780px of content height at the large font
            preference) without scrolling. If it must scroll, the app-wide thin
            scrollbar (index.css) keeps it unobtrusive. */}
        <SidebarContent className="gap-0">
          <NavGroup items={mainNav} current={current} label="Operations" />
          {catalogNav.length > 0 && <NavGroup items={catalogNav} current={current} label="Catalog" />}
          {adminNav.length > 0 && <NavGroup items={adminNav} current={current} label="Administration" />}
        </SidebarContent>
        <SidebarFooter>
          <UserMenu me={me} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      {/* min-w-0: without it the <main> flex item refuses to shrink below its
          widest descendant, so one wide table/chart drags the whole page into
          horizontal scroll and pushes the header actions off-screen. */}
      <SidebarInset className="min-w-0">
        <Topbar current={current} navItems={[...mainNav, ...catalogNav, ...adminNav]} />
        <div
          id="page-content"
          tabIndex={-1}
          data-slot="page-content"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6"
        >
          <RouteGuard role={role} />
        </div>
        <ReadonlyWatermark role={role} name={`${me.user.firstName} ${me.user.lastName}`} />
      </SidebarInset>
      <Toaster position="top-center" />
    </SidebarProvider>
  );
}

/**
 * Start collapsed to the icon rail on a compact laptop.
 *
 * The expanded sidebar is 16rem — 288px at this app's 18px root — which is 28%
 * of a 1024px screen and a big bite out of a 13" MacBook Air. The data tables
 * are what people came for, so below 1400px the rail wins by default. A saved
 * preference always beats the heuristic: this only decides the FIRST paint on a
 * machine that has never toggled it.
 */
function defaultSidebarOpen(): boolean {
  if (typeof document === "undefined") return true;
  const saved = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  if (saved) return saved[1] === "true";
  return window.innerWidth >= 1400;
}

/**
 * One gate for every screen. The sidebar filtered itself, but the routes did
 * not — so a READONLY user who typed /counts/<id> got the full count editor
 * with an enabled Save button, and only found out at the 403. The server was
 * never at risk; being walked to a submit button that cannot work is the
 * problem. Reuses the nav's own permission declarations, so the two cannot
 * drift apart.
 */
function RouteGuard({ role }: { role: Role }) {
  const { pathname } = useLocation();
  const { locationId } = useParams();
  const relative = locationId ? pathname.split(`/l/${locationId}/`)[1] ?? "" : "";
  const needed = permissionForPath(relative);
  const client = useCurrentClient();

  // Reports are gated per report, not just per section: an audit-service
  // viewer may open the reconciliation set and nothing else. Same predicate the
  // hub filters with and the server enforces.
  //
  // A report path can carry a query-like suffix on its own segment
  // (`full-audit?variance=only`), same as the hub's `r.path.split("?")[0]`,
  // so the slug taken from the URL is split the same way before either gate
  // sees it — otherwise "full-audit?variance=only" would never match a slug
  // in AUDIT_VIEWER_REPORTS or a subscription's enabled set.
  const reportSlug = relative.startsWith("reports/")
    ? (relative.slice("reports/".length).split("/")[0] ?? "").split("?")[0] || null
    : null;
  if (reportSlug && !canViewReport(role, reportSlug)) {
    return (
      <EmptyState
        icon={Lock}
        title="This report isn't part of your access"
        description="Your account covers the reconciliation reports. Ask the establishment owner or your LIS administrator if you need more."
        action={
          <Button asChild variant="outline">
            <Link to={`/l/${locationId}/reports`}>Back to Reports</Link>
          </Button>
        }
      />
    );
  }

  // Tier gate (docs/2026-08-04-report-tier-gating-plan.md, phases doc 4.2):
  // same composed check and same source (`client.subscription.reports`) as
  // the hub filter and the server middleware, so a report hidden from the
  // hub for tier reasons can't still be opened by typing its URL.
  const enabledReportSlugs = client?.subscription?.reports ?? [];
  if (reportSlug && !canViewReportForSubscription(role, reportSlug, enabledReportSlugs)) {
    return (
      <EmptyState
        icon={Lock}
        title="This report isn't part of your access"
        description="Your subscription doesn't include this report. Ask your LIS administrator if you need more."
        action={
          <Button asChild variant="outline">
            <Link to={`/l/${locationId}/reports`}>Back to Reports</Link>
          </Button>
        }
      />
    );
  }

  if (needed && !can(role, needed)) {
    return (
      <EmptyState
        icon={Lock}
        title="You don't have access to this screen"
        description="Your account doesn't include this area. If you need it, ask the owner or your LIS administrator to change your role."
        action={
          <Button asChild variant="outline">
            <Link to={`/l/${locationId}/dashboard`}>Back to Dashboard</Link>
          </Button>
        }
      />
    );
  }
  return <Outlet />;
}

function NavGroup({
  items,
  current,
  label,
}: {
  items: NavItem[];
  current: CurrentLocation;
  label: string;
}) {
  const { pathname } = useLocation();
  return (
    <SidebarGroup className="py-0.5">
      <SidebarGroupLabel className="h-6">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {items.map((item) => {
            const href = `/l/${current.id}/${item.path}`;
            const active = pathname.startsWith(href);
            return (
              <SidebarMenuItem key={item.path}>
                {/* py-1.5 keeps 14 items + 3 group labels inside a 13" laptop
                    viewport at the large font preference; 32px+ hit area holds. */}
                <SidebarMenuButton asChild isActive={active} tooltip={item.title} className="py-1.5">
                  <Link to={href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function LocationSwitcher({ me, current }: { me: MeResponse; current: CurrentLocation }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const switchTo = (locationId: string) => {
    // Keep the same page when switching locations (the modern ?bta-client=).
    const rest = pathname.replace(/^\/l\/[^/]+/, "");
    navigate(`/l/${locationId}${rest || "/dashboard"}`);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              // Without this a screen reader hears only the two names and the
              // logo's alt text, with nothing saying the control switches
              // establishment or location — and collapsed to the icon rail there
              // is no visible text at all.
              aria-label={`Establishment and location: ${current.clientName}, ${current.name}. Switch`}
              className="group/icon-hover data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:hover:bg-transparent! group-data-[collapsible=icon]:data-[state=open]:bg-transparent! group-data-[collapsible=icon]:h-12! pl-1"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md transition-opacity group-data-[collapsible=icon]:group-hover/icon-hover:opacity-80 group-data-[collapsible=icon]:group-data-[state=open]/icon-hover:opacity-80">
                <img src={lisLogo} alt="LIS" className="size-8 object-contain" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{current.clientName}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">{current.name}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start">
            {me.clients.map((client, i) => (
              <div key={client.id}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{client.name}</DropdownMenuLabel>
                {client.locations.map((loc) => (
                  <DropdownMenuItem key={loc.id} onSelect={() => switchTo(loc.id)}>
                    <span className="flex-1">{loc.name}</span>
                    {loc.kind && (
                      <span className="text-xs text-muted-foreground">
                        {LOCATION_KIND_LABELS[loc.kind as LocationKind] ?? loc.kind}
                      </span>
                    )}
                    {loc.id === current.id && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Plain-language role names — the raw enum is jargon (DESIGN.md voice). */
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  STAFF: "Staff",
  ACCOUNTANT: "Accountant",
  READONLY: "Read-only",
};

function UserMenu({ me }: { me: MeResponse }) {
  const logout = useLogout();
  const navigate = useNavigate();
  const initials = (me.user.firstName[0] ?? "") + (me.user.lastName[0] ?? "");

  const onLogout = async () => {
    await logout.mutateAsync();
    // The landing page, not /login. Signing out is a deliberate exit, and
    // dropping straight back onto a sign-in form reads as "that failed, try
    // again" rather than "you are out". The front door is the honest place to
    // land, and Open the System is one click away.
    navigate("/", { replace: true });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="group/icon-hover group-data-[collapsible=icon]:hover:bg-transparent! group-data-[collapsible=icon]:data-[state=open]:bg-transparent! data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:h-12!"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium transition-opacity group-data-[collapsible=icon]:group-hover/icon-hover:opacity-80 group-data-[collapsible=icon]:group-data-[state=open]/icon-hover:opacity-80">
                {initials.toUpperCase()}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">
                  {me.user.firstName} {me.user.lastName}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {ROLE_LABELS[me.user.role] ?? me.user.role}
                </span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start" side="top">
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              Signed in as {me.user.username}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut className="size-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  stock: "Local Database",
  counts: "Counts",
  purchases: "Purchases",
  transfers: "Transfers",
  sales: "Sales",
  recipes: "Recipes",
  imports: "Imports",
  reports: "Reports",
  items: "Main Database",
  suppliers: "Suppliers",
  settings: "Settings",
  admin: "Administration",
};

function Topbar({ current, navItems }: { current: CurrentLocation; navItems: NavItem[] }) {
  const { pathname } = useLocation();
  const segment = pathname.split("/")[3] ?? "dashboard";
  const title = PAGE_TITLES[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
  const [stockyOpen, setStockyOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" aria-label="Toggle navigation menu" />
      <Separator orientation="vertical" className="mr-1 !h-5" />
      <h1 className="text-sm font-medium">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        {/* Outstanding work, reachable from every page — the Dashboard panel
            only helps you when you are already on the Dashboard. */}
        <NotificationMenu locationId={current.id} />
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setStockyOpen(true)}
          aria-label="Ask Stocky"
        >
          <Sparkles className="size-4 text-primary" />
          <span className="hidden sm:inline">Stocky</span>
        </Button>
        <CommandPalette current={current} navItems={navItems} />
      </div>
      <StockySheet open={stockyOpen} onOpenChange={setStockyOpen} />
    </header>
  );
}

