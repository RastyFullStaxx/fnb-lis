import {
  Activity,
  ArrowLeftRight,
  BadgeCheck,
  Boxes,
  ClipboardList,
  FileInput,
  LayoutDashboard,
  Martini,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Building2,
  BarChart3,
} from "lucide-react";
import { can, allowedProductTypes, type Permission, type Role } from "@fnb/core";

export interface NavItem {
  title: string;
  path: string; // relative to /l/:locationId
  icon: typeof LayoutDashboard;
  permission?: Permission;
  /**
   * Product types (Category.productType) this nav item requires at least one
   * of to be meaningful. Omit for module-agnostic screens (Stock, Counts,
   * Purchases, Sales, Reports, etc.) whose *data* is already scoped server-side
   * via allowedProductTypes — the page itself still makes sense with zero rows.
   * Only screens that are conceptually tied to a specific catalog (menus are
   * built from Beverage/Food items — never Supplies/Asset) need this.
   */
  requiresProductTypes?: readonly string[];
}

export const MAIN_NAV: NavItem[] = [
  { title: "Dashboard", path: "dashboard", icon: LayoutDashboard },
  { title: "Local Database", path: "stock", icon: Boxes },
  { title: "Counts", path: "counts", icon: ClipboardList, permission: "entries.create" },
  { title: "Purchases", path: "purchases", icon: ShoppingCart, permission: "entries.create" },
  { title: "Transfers", path: "transfers", icon: ArrowLeftRight, permission: "entries.create" },
  // Deliberately module-agnostic (asset-module-phases.md 3.3 — not left as a
  // default, decided): Sales already has a live, non-hypothetical use for
  // Asset-only locations via its Non-revenue tab — ASSET_LOSS_REASONS
  // (BREAKAGE/LOST/STOLEN/RETIRED) exist specifically for Asset SaleRecord
  // rows, and assetBreakageReport already reads them. Gating this the same
  // way as Recipes would remove a feature that's already shipped and working,
  // not just withhold one that was never applicable.
  { title: "Sales", path: "sales", icon: Receipt, permission: "entries.create" },
  {
    title: "Recipes",
    path: "recipes",
    icon: Martini,
    permission: "menus.write",
    requiresProductTypes: ["Beverage", "Food"],
  },
  { title: "Imports", path: "imports", icon: FileInput, permission: "imports.upload" },
  { title: "Reports", path: "reports", icon: BarChart3, permission: "reports.view" },
];

export const CATALOG_NAV: NavItem[] = [
  { title: "Main Database", path: "items", icon: Package, permission: "master.write" },
  { title: "Suppliers", path: "suppliers", icon: Truck, permission: "master.write" },
  { title: "Settings", path: "settings", icon: Settings, permission: "master.write" },
];

// Subscriptions are managed inline inside the Clients page — no separate nav item.
export const ADMIN_NAV: NavItem[] = [
  { title: "Clients", path: "admin/clients", icon: Building2, permission: "admin.manage" },
  { title: "Users", path: "admin/users", icon: UserCog, permission: "admin.manage" },
  { title: "Activity", path: "admin/activity", icon: Activity, permission: "activity.view" },
];

/**
 * @param locationModules The active LOCATION's own modules (e.g. ["BAR"]) —
 * the enforced reality per Fix Plan §2.3, not the client's subscription
 * ceiling. Null/empty for an unassigned/legacy location — which stays
 * unrestricted, matching the server's `allowedProductTypes(null) -> null`.
 */
export function visibleNav(items: NavItem[], role: Role, locationModules?: readonly string[] | null): NavItem[] {
  const allowedTypes = allowedProductTypes(locationModules);
  return items.filter((item) => {
    if (item.permission && !can(role, item.permission)) return false;
    if (item.requiresProductTypes && allowedTypes) {
      if (!item.requiresProductTypes.some((t) => allowedTypes.includes(t))) return false;
    }
    return true;
  });
}
