export const ROLES = ["ADMIN", "MANAGER", "STAFF", "ACCOUNTANT", "READONLY"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const RECORD_STATUSES = ["ACTIVE", "VOID"] as const;
export const SESSION_STATUSES = ["OPEN", "COMMITTED", "VOID"] as const;
export const PURCHASE_STATUSES = ["DRAFT", "COMMITTED", "VOID"] as const;
export const TRANSFER_STATUSES = ["DRAFT", "COMMITTED", "VOID"] as const;
export const COUNT_TYPES = ["FULL", "WEIGH"] as const;
export const WEIGH_MODES = ["DENSITY", "NET"] as const;
export type WeighMode = (typeof WEIGH_MODES)[number];

/** Location kind is a grouping label (main bar / satellites / stockroom) — no behavior branches on it. */
export const LOCATION_KINDS = ["MAIN", "SATELLITE", "STOCKROOM"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  MAIN: "Main",
  SATELLITE: "Satellite",
  STOCKROOM: "Stockroom",
};
export const SALE_KINDS = ["SALE", "NON_REVENUE", "PRODUCTION"] as const;
export type SaleKind = (typeof SALE_KINDS)[number];
export const UNIT_KINDS = ["VOLUME", "MASS", "COUNT"] as const;
export const IMPORT_KINDS = ["SALES", "PURCHASES", "NON_REVENUE", "COUNTS"] as const;
export const IMPORT_STATUSES = ["PROCESSING", "NEEDS_REVIEW", "COMMITTED", "REVERSED", "FAILED"] as const;
export const MATCH_METHODS = ["EXACT", "ALIAS", "FUZZY", "MANUAL"] as const;

/**
 * Inventory cost basis (client decision, 2026-07-20). An accounting POLICY,
 * so it is stored per client and applies to VALUATION only — stock worth,
 * never variance. PAS 2 / IAS 2 permit FIFO or weighted average but require
 * one formula applied consistently to inventories of similar nature, which is
 * why this is a saved setting rather than a per-export button.
 *
 * PRICE   — the cost snapshotted on the count line (falls back to the catalog
 *           cost price). The default: matches every number shipped to date.
 * AVERAGE — periodic weighted average cost: (opening stock value + purchases
 *           value) ÷ (opening qty + purchased qty), as of the valuation date.
 *           Opening stock MUST participate; averaging purchases alone is
 *           "average purchase price", a different (and wrong) figure.
 */
export const COST_BASES = ["PRICE", "AVERAGE"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export const COST_BASIS_LABELS: Record<CostBasis, string> = {
  PRICE: "Purchase Price",
  AVERAGE: "Weighted Average",
};

/** Slug for export filenames — two files with the same title but different
    totals must be tellable apart on disk. */
export const COST_BASIS_SLUGS: Record<CostBasis, string> = {
  PRICE: "purchase-price",
  AVERAGE: "weighted-average",
};

export function isCostBasis(value: unknown): value is CostBasis {
  return typeof value === "string" && (COST_BASES as readonly string[]).includes(value);
}

export const NON_REVENUE_REASONS = [
  // Canonical encoding options (client req, 2026-07-20) — the only three the
  // entry screens offer. Each generates its own report view; the Full Audit
  // keeps rolling everything up under Non-Revenue.
  "SPOILAGE_SPILLAGE",
  "TRIMMING",
  "MARKETING_OTH",
  // Legacy codes — still valid so historical rows and imports keep parsing.
  "COMPLIMENTARY",
  "SPILLAGE",
  "STAFF_USE",
  "SPOILAGE",
  "BREAKAGE",
  "TASTING",
  "INTERNAL_USE",
  "OTHER",
] as const;
export type NonRevenueReason = (typeof NON_REVENUE_REASONS)[number];

/** The client's three canonical non-revenue buckets. */
export const NON_REVENUE_GROUPS = ["SPOILAGE_SPILLAGE", "TRIMMING", "MARKETING_OTH"] as const;
export type NonRevenueGroup = (typeof NON_REVENUE_GROUPS)[number];

export const NON_REVENUE_GROUP_LABELS: Record<NonRevenueGroup, string> = {
  SPOILAGE_SPILLAGE: "Spoilage & Spillages",
  TRIMMING: "Trimming",
  MARKETING_OTH: "Marketing & OTH (On the House)",
};

/**
 * Which bucket a stored reason reports under. Legacy codes fold into the
 * nearest bucket; STAFF_USE / INTERNAL_USE / OTHER belong to none — they
 * appear only in the unfiltered report, never silently inside a bucket.
 */
export function nonRevenueGroupOf(reason: string | null | undefined): NonRevenueGroup | null {
  switch (reason) {
    case "SPOILAGE_SPILLAGE":
    case "SPILLAGE":
    case "SPOILAGE":
    case "BREAKAGE":
      return "SPOILAGE_SPILLAGE";
    case "TRIMMING":
      return "TRIMMING";
    case "MARKETING_OTH":
    case "COMPLIMENTARY":
    case "TASTING":
      return "MARKETING_OTH";
    default:
      return null;
  }
}

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
 * Sensible starting values for a brand-new subscription form (Basic tier:
 * Monthly billing, 1 location). Only used to seed initial form state — see
 * derivePackageType() below for how the tier is actually determined once
 * billing cycle and max locations are set.
 */
export const PACKAGE_DEFAULT_MAX_ENTITIES: Record<PackageType, number> = {
  BASIC: 1,
  MEDIUM: 5,
  ONE_TIME: 0, // unlimited
};

/** @see PACKAGE_DEFAULT_MAX_ENTITIES */
export const PACKAGE_DEFAULT_BILLING_CYCLE: Record<PackageType, BillingCycle> = {
  BASIC: "MONTHLY",
  MEDIUM: "MONTHLY",
  ONE_TIME: "STANDALONE",
};

/**
 * Derives the "Basic / Medium / One-Time Installation" package tier from the
 * two fields that actually define it, per the client's spec:
 *   - Basic:   1 account/entity only
 *   - Medium:  1 to 5 accounts/entities
 *   - One-Time Installation: unlimited accounts/entities
 *
 * packageType is NOT a separately-settable field anywhere in the app — it
 * used to be, and could silently drift from the truth (e.g. a client badged
 * "Basic" while actually licensed for unlimited locations). It's now always
 * computed from billingCycle + maxEntities, both at write time (server) and
 * for display (client), so the badge can never lie again.
 *
 *  - STANDALONE billing => "One-Time Installation", regardless of
 *    maxEntities — the tier is defined by "pay once, no recurring bill",
 *    not by the count.
 *  - MONTHLY + exactly 1 location => "Basic".
 *  - MONTHLY + 2 or more locations (including 0 = unlimited, an
 *    intentionally-negotiated case outside the standard tiers) => "Medium".
 */
export function derivePackageType(billingCycle: BillingCycle, maxEntities: number): PackageType {
  if (billingCycle === "STANDALONE") return "ONE_TIME";
  return maxEntities === 1 ? "BASIC" : "MEDIUM";
}

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  BAR: "Bar",
  KITCHEN: "Kitchen",
  ASSET: "Asset",
};

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
  // typeof-narrowing rather than Array.isArray: isArray doesn't narrow
  // `readonly string[]` unions, which trips the strict typecheck.
  const list = typeof modules === "string" ? splitLegacyModuleCombo(modules) : modules;
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
  // READONLY included per client request: 3rd-party audit-service viewers may
  // view AND download reports — their exports carry the exporter footer.
  "reports.export": ["ADMIN", "MANAGER", "ACCOUNTANT", "READONLY"],
  "activity.view": ["ADMIN", "MANAGER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
