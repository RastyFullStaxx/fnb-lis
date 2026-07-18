export const ROLES = ["ADMIN", "MANAGER", "STAFF", "ACCOUNTANT", "READONLY"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const RECORD_STATUSES = ["ACTIVE", "VOID"] as const;
export const SESSION_STATUSES = ["OPEN", "COMMITTED", "VOID"] as const;
export const PURCHASE_STATUSES = ["DRAFT", "COMMITTED", "VOID"] as const;
export const COUNT_TYPES = ["FULL", "WEIGH"] as const;
export const SALE_KINDS = ["SALE", "NON_REVENUE", "PRODUCTION"] as const;
export type SaleKind = (typeof SALE_KINDS)[number];
export const UNIT_KINDS = ["VOLUME", "MASS", "COUNT"] as const;
export const IMPORT_KINDS = ["SALES", "PURCHASES", "NON_REVENUE", "COUNTS"] as const;
export const IMPORT_STATUSES = ["PROCESSING", "NEEDS_REVIEW", "COMMITTED", "REVERSED", "FAILED"] as const;
export const MATCH_METHODS = ["EXACT", "ALIAS", "FUZZY", "MANUAL"] as const;

export const NON_REVENUE_REASONS = [
  "COMPLIMENTARY",
  "SPILLAGE",
  "STAFF_USE",
  "SPOILAGE",
  "BREAKAGE",
  "TASTING",
  "INTERNAL_USE",
  "OTHER",
] as const;

// ── Subscription / Package constants ──

/** Subscription package types */
export const PACKAGE_TYPES = ["BASIC", "MEDIUM", "ONE_TIME"] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

/** Billing / delivery mode */
export const BILLING_CYCLES = ["STANDALONE", "MONTHLY"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/**
 * Atomic inventory modules (Fix Plan Phase C). Replaces the old 5-value
 * closed-combo enum (`BAR | KITCHEN | ASSET | BAR_KITCHEN | BAR_KITCHEN_ASSET`)
 * with the three real, composable units. A "package" is now any subset of
 * these — {BAR, ASSET}, all three, etc. — represented as multiple rows
 * (SubscriptionModule / PlanModule / LocationModule), never as a combo string.
 */
export const MODULE_TYPES = ["BAR", "KITCHEN", "ASSET"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

/** @deprecated Renamed to `MODULE_TYPES` now that modules are atomic (Phase C). Kept as an alias during migration. */
export const INVENTORY_MODULES = MODULE_TYPES;
/** @deprecated Renamed to `ModuleType`. Kept as an alias during migration. */
export type InventoryModule = ModuleType;

/** Subscription statuses */
export const SUBSCRIPTION_STATUSES = ["ACTIVE", "SUSPENDED", "CANCELLED", "TRIAL"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Human-readable labels */
export const PACKAGE_LABELS: Record<PackageType, string> = {
  BASIC: "Basic",
  MEDIUM: "Medium",
  ONE_TIME: "One-Time Installation",
};

/**
 * Default maxEntities to pre-fill when an admin picks a package tier in a
 * form — a starting point, not an enforced ceiling. The actual maxEntities
 * on a Subscription is a directly-settable field (see admin.ts), so any
 * value can be typed in over this default; nothing recalculates it after
 * creation. (Fix Plan Phase B: billing cycle & entity count decoupled from
 * package tier — packageType alone no longer determines either.)
 */
export const PACKAGE_DEFAULT_MAX_ENTITIES: Record<PackageType, number> = {
  BASIC: 1,
  MEDIUM: 5,
  ONE_TIME: 0, // unlimited
};

/**
 * Default billingCycle to pre-fill when an admin picks a package tier in a
 * form — a starting point, not a derivation. The actual billingCycle on a
 * Subscription is a directly-settable field (see admin.ts); an admin can
 * sell "Basic, one-time payment" or "One-Time package, billed monthly" by
 * simply choosing a different value here. (Fix Plan Phase B.)
 */
export const PACKAGE_DEFAULT_BILLING_CYCLE: Record<PackageType, BillingCycle> = {
  BASIC: "MONTHLY",
  MEDIUM: "MONTHLY",
  ONE_TIME: "STANDALONE",
};

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  BAR: "Bar",
  KITCHEN: "Kitchen",
  ASSET: "Asset",
};

/** @deprecated Renamed to `MODULE_TYPE_LABELS`. Kept as an alias during migration. */
export const INVENTORY_MODULE_LABELS = MODULE_TYPE_LABELS;

/**
 * Which master `Category.productType` values ("Beverage" | "Food" | "Supplies" |
 * "Asset" — see Setting "productTypes") a single atomic module unlocks.
 *
 * This is the single mapping that turns a module set into an actual restriction:
 * every place that scopes catalog data to a client/location (attaching items,
 * listing a location's catalog, filtering reports) should intersect against
 * `allowedProductTypes(modules)` rather than trusting the caller's own
 * productType query param.
 *
 * Asset now has its own real product type (Fix Plan Phase E, resolved open
 * question #4) — the original modernization plan already listed Asset and
 * Supply as separate item types (Asset: non-consumable equipment/tools/
 * furniture; Supplies: consumable napkins/gloves/etc.), and the "Supplies"
 * alias here was only ever a stopgap until this split landed.
 */
export const MODULE_PRODUCT_TYPES: Record<ModuleType, readonly string[]> = {
  BAR: ["Beverage"],
  KITCHEN: ["Food"],
  ASSET: ["Asset"],
};

/** @deprecated Renamed to `MODULE_PRODUCT_TYPES`. Kept as an alias during migration. */
export const INVENTORY_MODULE_PRODUCT_TYPES = MODULE_PRODUCT_TYPES;

/**
 * Product types allowed for a given set of modules (null/undefined/empty =
 * unrestricted — legacy/unassigned clients, or callers that pass through the
 * whole-client ceiling rather than a location's own set).
 *
 * Accepts either:
 *  - a module list (`["BAR", "KITCHEN"]`) — the composable shape everywhere
 *    a SubscriptionModule/LocationModule set is read from, or
 *  - a single legacy combo string (`"BAR_KITCHEN"`) — accepted for backward
 *    compatibility while any pre-migration data/tests still pass one in.
 */
export function allowedProductTypes(
  modules: readonly string[] | string | null | undefined,
): readonly string[] | null {
  if (!modules) return null; // nothing on record -> don't restrict (legacy/unassigned clients)
  const list = Array.isArray(modules) ? modules : splitLegacyModuleCombo(modules);
  if (list.length === 0) return null;
  const types = new Set<string>();
  for (const m of list) {
    for (const t of MODULE_PRODUCT_TYPES[m as ModuleType] ?? []) types.add(t);
  }
  return types.size > 0 ? [...types] : null;
}

/** Whether a given Category.productType is permitted under a module set. */
export function isProductTypeAllowed(
  productType: string,
  modules: readonly string[] | string | null | undefined,
): boolean {
  const allowed = allowedProductTypes(modules);
  if (!allowed) return true;
  return allowed.includes(productType);
}

/**
 * Splits a legacy pre-Phase-C combo string ("BAR_KITCHEN_ASSET", etc.) into
 * atomic modules. Only exists to keep `allowedProductTypes` accepting old
 * values during migration — new code should always pass an array of atomic
 * modules (from SubscriptionModule/LocationModule rows) instead.
 */
function splitLegacyModuleCombo(combo: string): ModuleType[] {
  return MODULE_TYPES.filter((m) => combo === m || combo.split("_").includes(m));
}

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  STANDALONE: "Standalone (One-Time)",
  MONTHLY: "Monthly Subscription",
};

/** Failed logins before a 1-hour lockout (ported from legacy). */
export const LOGIN_LOCKOUT_THRESHOLD = 5;
export const LOGIN_LOCKOUT_MS = 60 * 60 * 1000;

export const PERMISSIONS = {
  "admin.manage": ["ADMIN"],
  "master.write": ["ADMIN", "MANAGER"],
  "prices.edit": ["ADMIN", "MANAGER"],
  "entries.create": ["ADMIN", "MANAGER", "STAFF"],
  "entries.void": ["ADMIN", "MANAGER"],
  "menus.write": ["ADMIN", "MANAGER"],
  "imports.upload": ["ADMIN", "MANAGER"],
  "imports.commit": ["ADMIN", "MANAGER"],
  "reports.view": ["ADMIN", "MANAGER", "STAFF", "ACCOUNTANT", "READONLY"],
  "reports.export": ["ADMIN", "MANAGER", "ACCOUNTANT"],
  "activity.view": ["ADMIN", "MANAGER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
