import {
  Activity,
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
import { can, type Permission, type Role } from "@fnb/core";

export interface NavItem {
  title: string;
  path: string; // relative to /l/:locationId
  icon: typeof LayoutDashboard;
  permission?: Permission;
}

export const MAIN_NAV: NavItem[] = [
  { title: "Dashboard", path: "dashboard", icon: LayoutDashboard },
  { title: "Stock", path: "stock", icon: Boxes },
  { title: "Counts", path: "counts", icon: ClipboardList, permission: "entries.create" },
  { title: "Purchases", path: "purchases", icon: ShoppingCart, permission: "entries.create" },
  { title: "Sales", path: "sales", icon: Receipt, permission: "entries.create" },
  { title: "Recipes", path: "recipes", icon: Martini, permission: "menus.write" },
  { title: "Imports", path: "imports", icon: FileInput, permission: "imports.upload" },
  { title: "Reports", path: "reports", icon: BarChart3, permission: "reports.view" },
];

export const CATALOG_NAV: NavItem[] = [
  { title: "Items", path: "items", icon: Package, permission: "master.write" },
  { title: "Suppliers", path: "suppliers", icon: Truck, permission: "master.write" },
  { title: "Settings", path: "settings", icon: Settings, permission: "master.write" },
];

export const ADMIN_NAV: NavItem[] = [
  { title: "Clients", path: "admin/clients", icon: Building2, permission: "admin.manage" },
  { title: "Users", path: "admin/users", icon: UserCog, permission: "admin.manage" },
  { title: "Activity", path: "admin/activity", icon: Activity, permission: "activity.view" },
];

export function visibleNav(items: NavItem[], role: Role): NavItem[] {
  return items.filter((item) => !item.permission || can(role, item.permission));
}
