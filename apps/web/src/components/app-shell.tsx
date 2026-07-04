import { useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { Check, ChevronsUpDown, LogOut, Sparkles } from "lucide-react";
import type { MeResponse } from "@fnb/core";
import { useLogout, useMe } from "@/api/auth";
import { ApiError } from "@/api/http";
import { FullPageSpinner } from "@/components/full-page-spinner";
import { ADMIN_NAV, CATALOG_NAV, MAIN_NAV, visibleNav, type NavItem } from "@/lib/nav";
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
import { StockySheet } from "@/components/stocky/stocky-sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";

export function AppShell() {
  const me = useMe();
  const { locationId } = useParams();

  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace />;
    }
    return <FullPageSpinner error="Could not reach the server. Is the API running?" />;
  }

  const allLocations = me.data.clients.flatMap((c) =>
    c.locations.map((l) => ({ ...l, clientName: c.name })),
  );
  const current = allLocations.find((l) => l.id === locationId);
  if (!current) {
    const first = allLocations[0];
    return first ? <Navigate to={`/l/${first.id}/dashboard`} replace /> : (
      <FullPageSpinner error="Your account has no assigned client locations yet." />
    );
  }

  return <ShellLayout me={me.data} current={current} />;
}

interface CurrentLocation {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
}

function ShellLayout({ me, current }: { me: MeResponse; current: CurrentLocation }) {
  const role = me.user.role;
  const mainNav = visibleNav(MAIN_NAV, role);
  const catalogNav = visibleNav(CATALOG_NAV, role);
  const adminNav = visibleNav(ADMIN_NAV, role);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <LocationSwitcher me={me} current={current} />
        </SidebarHeader>
        <SidebarContent>
          <NavGroup items={mainNav} current={current} label="Operations" />
          {catalogNav.length > 0 && <NavGroup items={catalogNav} current={current} label="Catalog" />}
          {adminNav.length > 0 && <NavGroup items={adminNav} current={current} label="Administration" />}
        </SidebarContent>
        <SidebarFooter>
          <UserMenu me={me} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <Topbar current={current} navItems={[...mainNav, ...catalogNav, ...adminNav]} />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
      <Toaster position="top-right" />
    </SidebarProvider>
  );
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
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const href = `/l/${current.id}/${item.path}`;
            const active = pathname.startsWith(href);
            return (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
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
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                L
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

function UserMenu({ me }: { me: MeResponse }) {
  const logout = useLogout();
  const navigate = useNavigate();
  const initials = (me.user.firstName[0] ?? "") + (me.user.lastName[0] ?? "");

  const onLogout = async () => {
    await logout.mutateAsync();
    navigate("/login", { replace: true });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">
                {initials.toUpperCase()}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">
                  {me.user.firstName} {me.user.lastName}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">{me.user.role}</span>
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
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  stock: "Stock",
  counts: "Counts",
  purchases: "Purchases",
  sales: "Sales",
  recipes: "Recipes",
  imports: "Imports",
  reports: "Reports",
  items: "Items",
  suppliers: "Suppliers",
  settings: "Settings",
  admin: "Administration",
};

function Topbar({ current, navItems }: { current: CurrentLocation; navItems: NavItem[] }) {
  const { pathname } = useLocation();
  const segment = pathname.split("/")[3] ?? "dashboard";
  const title = PAGE_TITLES[segment] ?? "";
  const [stockyOpen, setStockyOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-5" />
      <h1 className="text-sm font-medium">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setStockyOpen(true)}
          aria-label="Ask Stocky"
        >
          <Sparkles className="size-3.5 text-primary" />
          <span className="hidden sm:inline">Stocky</span>
        </Button>
        <CommandPalette current={current} navItems={navItems} />
      </div>
      <StockySheet open={stockyOpen} onOpenChange={setStockyOpen} />
    </header>
  );
}

