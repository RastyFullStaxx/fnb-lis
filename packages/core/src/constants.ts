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

/** Inventory modules that can be enabled per subscription */
export const INVENTORY_MODULES = ["BAR", "KITCHEN", "ASSET", "BAR_KITCHEN", "BAR_KITCHEN_ASSET"] as const;
export type InventoryModule = (typeof INVENTORY_MODULES)[number];

/** Subscription statuses */
export const SUBSCRIPTION_STATUSES = ["ACTIVE", "SUSPENDED", "CANCELLED", "TRIAL"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Maximum entities (clients/locations) allowed per package.
 * 0 = unlimited (ONE_TIME).
 */
export const PACKAGE_MAX_ENTITIES: Record<PackageType, number> = {
  BASIC: 1,
  MEDIUM: 5,
  ONE_TIME: 0, // unlimited
};

/** Human-readable labels */
export const PACKAGE_LABELS: Record<PackageType, string> = {
  BASIC: "Basic",
  MEDIUM: "Medium",
  ONE_TIME: "One-Time Installation",
};

/**
 * Billing cycle is not an independent choice — it's implied by the package.
 * BASIC/MEDIUM are capped, ongoing-access tiers, so they only make sense as
 * a recurring charge. ONE_TIME is the unlimited, pay-once-and-own-it tier,
 * so it only makes sense as a standalone charge. The UI derives billingCycle
 * from packageType via this map instead of exposing it as a separate field.
 */
export const PACKAGE_BILLING_CYCLE: Record<PackageType, BillingCycle> = {
  BASIC: "MONTHLY",
  MEDIUM: "MONTHLY",
  ONE_TIME: "STANDALONE",
};

/** Short qualifier for compact inline display next to a package label, e.g. in a Select item's secondary text. */
export const BILLING_CYCLE_SHORT_LABELS: Record<BillingCycle, string> = {
  STANDALONE: "One-time",
  MONTHLY: "Monthly",
};

export const INVENTORY_MODULE_LABELS: Record<InventoryModule, string> = {
  BAR: "Bar Inventory Only",
  KITCHEN: "Kitchen Inventory Only",
  ASSET: "Asset Inventory Only",
  BAR_KITCHEN: "Bar & Kitchen Inventory",
  BAR_KITCHEN_ASSET: "Bar, Kitchen & Asset Inventory",
};

/**
 * Which master `Category.productType` values ("Beverage" | "Food" | "Supplies" —
 * see Setting "productTypes") a subscription's inventory module unlocks.
 *
 * This is the single mapping that turns "inventoryModules" from a label into an
 * actual restriction: every place that scopes catalog data to a client/location
 * (attaching items, listing a location's catalog, filtering reports) should
 * intersect against `allowedProductTypes(subscription)` rather than trusting
 * the caller's own productType query param.
 *
 * "Asset" has no seeded product type of its own yet (the legacy catalog only
 * ever had Beverage/Food/Supplies) — it maps to "Supplies", which is where
 * non-consumable/equipment-style items already land (see seed categories).
 * If a client later wants a dedicated "Asset" product type, add it to the
 * global Setting "productTypes" list and to this map — no schema change needed.
 */
export const INVENTORY_MODULE_PRODUCT_TYPES: Record<InventoryModule, readonly string[]> = {
  BAR: ["Beverage"],
  KITCHEN: ["Food"],
  ASSET: ["Supplies"],
  BAR_KITCHEN: ["Beverage", "Food"],
  BAR_KITCHEN_ASSET: ["Beverage", "Food", "Supplies"],
};

/** Product types allowed for a given subscription (null/no-subscription = unrestricted). */
export function allowedProductTypes(inventoryModules: string | null | undefined): readonly string[] | null {
  if (!inventoryModules) return null; // no subscription on record -> don't restrict (legacy/unassigned clients)
  const types = INVENTORY_MODULE_PRODUCT_TYPES[inventoryModules as InventoryModule];
  return types ?? null;
}

/** Whether a given Category.productType is permitted under a subscription's modules. */
export function isProductTypeAllowed(
  productType: string,
  inventoryModules: string | null | undefined,
): boolean {
  const allowed = allowedProductTypes(inventoryModules);
  if (!allowed) return true;
  return allowed.includes(productType);
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
