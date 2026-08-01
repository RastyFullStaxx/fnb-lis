/**
 * ADMIN is the LIS system operator (us). OWNER is the CLIENT who bought the
 * subscription — client req 2026-07-25: "the owner client is the only one who
 * can disable his employee's account, including the Manager role". So OWNER
 * sits above MANAGER but is scoped to his own establishment: he manages his own
 * staff and never sees another tenant.
 */
export const ROLES = [
  "ADMIN",
  "OWNER",
  "MANAGER",
  "STAFF",
  "ACCOUNTANT",
  "AUDIT_VIEWER",
  "AUDIT_VIEWER_LIMITED",
] as const;
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
 * Supplier payment terms (client req, 2026-07-20: "lagay din natin options
 * info ng supplier, contact details at kung ano terms ng payment nila —
 * C.O.D, 7, or 15 days"). TEXT, not an enum, per the SQLite portability rule.
 */
export const PAYMENT_TERMS = ["COD", "NET_7", "NET_15", "NET_30", "PREPAID"] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  COD: "C.O.D.",
  NET_7: "7 Days",
  NET_15: "15 Days",
  NET_30: "30 Days",
  PREPAID: "Prepaid",
};

/** Days until payment is due; null when the term isn't a credit period. */
export const PAYMENT_TERMS_DAYS: Record<PaymentTerms, number | null> = {
  COD: 0,
  NET_7: 7,
  NET_15: 15,
  NET_30: 30,
  PREPAID: null,
};

export function isPaymentTerms(value: unknown): value is PaymentTerms {
  return typeof value === "string" && (PAYMENT_TERMS as readonly string[]).includes(value);
}

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
  // Asset-loss reasons (client req 2026-07-21) — "what happened" to a piece of
  // equipment. Assets aren't consumed; they leave the register when they break,
  // go missing, or are retired. Recorded as non-revenue like any stock-out.
  "LOST",
  "STOLEN",
  "RETIRED",
] as const;
export type NonRevenueReason = (typeof NON_REVENUE_REASONS)[number];

/** The client's three canonical non-revenue buckets. */
export const NON_REVENUE_GROUPS = ["SPOILAGE_SPILLAGE", "TRIMMING", "MARKETING_OTH"] as const;
export type NonRevenueGroup = (typeof NON_REVENUE_GROUPS)[number];

export const NON_REVENUE_GROUP_LABELS: Record<NonRevenueGroup, string> = {
  SPOILAGE_SPILLAGE: "Spoilage & Spillages",
  TRIMMING: "Trimming",
  MARKETING_OTH: "Marketing & OTH",
};

/**
 * Reasons an ASSET (equipment) leaves the register — "what happened to the
 * item" (client req 2026-07-21). Offered when recording non-revenue for an
 * asset item, and shown in the Asset Breakage report.
 */
export const ASSET_LOSS_REASONS = ["BREAKAGE", "LOST", "STOLEN", "RETIRED"] as const;
export type AssetLossReason = (typeof ASSET_LOSS_REASONS)[number];

export const ASSET_LOSS_REASON_LABELS: Record<AssetLossReason, string> = {
  BREAKAGE: "Broken / Damaged",
  LOST: "Lost / Missing",
  STOLEN: "Stolen",
  RETIRED: "Retired / Disposed",
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
export const PACKAGE_TYPES = ["BASIC", "MEDIUM", "FULL", "ONE_TIME"] as const;
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
  FULL: "Full",
  ONE_TIME: "One-Time Installation",
};

/**
 * Max USER accounts per monthly tier (client req 2026-07-21): Basic 1,
 * Medium 5, Full 10. Standalone is owner-set, so it has no fixed number —
 * `0` here means "whatever the owner saved", never unlimited-by-default.
 */
export const PACKAGE_MAX_USERS: Record<PackageType, number> = {
  BASIC: 1,
  MEDIUM: 5,
  FULL: 10,
  ONE_TIME: 0, // owner sets it explicitly on the subscription
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
  FULL: 10,
  ONE_TIME: 0, // admin-set at creation; 0 is just the form's starting point, not an implied "unlimited"
};

/** @see PACKAGE_DEFAULT_MAX_ENTITIES */
export const PACKAGE_DEFAULT_BILLING_CYCLE: Record<PackageType, BillingCycle> = {
  BASIC: "MONTHLY",
  MEDIUM: "MONTHLY",
  FULL: "MONTHLY",
  ONE_TIME: "STANDALONE",
};

/**
 * Derives the package tier from the fields that actually define it. The tier
 * is named by MAX USERS (client req 2026-07-21: "monthly, add Full — max users
 * up to 10"), falling back to max locations for pre-maxUsers rows (maxUsers=0
 * from the migration default) so nothing already in the database silently
 * jumps to a different tier the first time this runs against it.
 *
 * packageType is NOT a separately-settable field anywhere in the app — it
 * used to be, and could silently drift from the truth (e.g. a client badged
 * "Basic" while actually licensed for unlimited locations). It's always
 * computed, both at write time (server) and for display (client), so the badge
 * can never lie again.
 *
 *  - STANDALONE billing => "One-Time Installation", regardless of the counts —
 *    the tier is "pay once, no recurring bill", and the owner sets his own
 *    user cap so accounts can't be generated behind his back.
 *  - MONTHLY: 1 user => Basic, 2-5 => Medium, 6+ (or unlimited) => Full.
 */
export function derivePackageType(
  billingCycle: BillingCycle,
  maxEntities: number,
  maxUsers = 0,
): PackageType {
  if (billingCycle === "STANDALONE") return "ONE_TIME";
  // Pre-maxUsers subscriptions carry 0 — fall back to the old location rule so
  // existing rows keep their badge instead of all jumping to Full.
  const n = maxUsers > 0 ? maxUsers : maxEntities;
  if (n === 1) return "BASIC";
  return n <= PACKAGE_MAX_USERS.MEDIUM && n > 0 ? "MEDIUM" : "FULL";
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

/**
 * Roles that MUST hold a second factor on the browser login (client decision
 * 2026-08-01). These are the two roles that can create users, so compromising
 * one is compromising everything below it — ADMIN across every establishment,
 * OWNER across his own.
 *
 * MANAGER and below are deliberately excluded, STAFF most of all: they sign in
 * on a shared bar PC mid-shift, already carry a device PIN, and are already
 * restricted to appends. Demanding a phone code there costs a counting workflow
 * real time and buys very little.
 *
 * Enforcement is server-side in requireMfaEnrolment (middleware/auth.ts), not
 * in the UI — the same rule as every other permission here.
 */
export const MFA_REQUIRED_ROLES = ["ADMIN", "OWNER"] as const;

export function mfaRequiredFor(role: Role): boolean {
  return (MFA_REQUIRED_ROLES as readonly string[]).includes(role);
}

/** How long the gap between "password accepted" and "code accepted" may stay open. */
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Single-use recovery codes handed out at enrolment. */
export const MFA_BACKUP_CODE_COUNT = 10;

export const PERMISSIONS = {
  // Cross-tenant system administration (every client, every location). ADMIN only —
  // an OWNER must never reach another establishment's data.
  "admin.manage": ["ADMIN"],
  /**
   * Manage the user accounts of ONE establishment: create, reset password,
   * disable/enable (client req 2026-07-25). The OWNER holds this for his own
   * client; ADMIN holds it everywhere. MANAGER deliberately does NOT — the
   * client was explicit that the owner alone disables staff, managers included.
   */
  "users.manage": ["ADMIN", "OWNER"],
  /**
   * Register a new offline desktop, and revoke one. Consuming a licence slot
   * (Subscription.maxDevices, proposal §18/§20) is a commercial act, so it sits
   * with the establishment's OWNER and the LIS ADMIN — not with MANAGER, who
   * can sign in on a machine that is already registered but cannot bind the
   * licence to another one.
   */
  "devices.manage": ["ADMIN", "OWNER"],
  /**
   * Tare + liquid (density) weights are LIS's own calibration data — a client
   * reports that a bottle needs one, the LIS admin supplies it (client decision
   * 2026-07-25). Separate from master.write so a client MANAGER can still run
   * his catalog without being able to read or rewrite the weight library.
   */
  "weights.manage": ["ADMIN"],
  "master.write": ["ADMIN", "OWNER", "MANAGER"],
  "prices.edit": ["ADMIN", "OWNER", "MANAGER"],
  "entries.create": ["ADMIN", "OWNER", "MANAGER", "STAFF"],
  "entries.void": ["ADMIN", "OWNER", "MANAGER"],
  "menus.write": ["ADMIN", "OWNER", "MANAGER"],
  "imports.upload": ["ADMIN", "OWNER", "MANAGER"],
  "imports.commit": ["ADMIN", "OWNER", "MANAGER"],
  "reports.view": [
    "ADMIN",
    "OWNER",
    "MANAGER",
    "STAFF",
    "ACCOUNTANT",
    "AUDIT_VIEWER",
    "AUDIT_VIEWER_LIMITED",
  ],
  // AUDIT_VIEWER (paid) included per client request: 3rd-party audit-service
  // viewers may view AND download reports — their exports carry the exporter
  // footer. AUDIT_VIEWER_LIMITED (unpaid) gets reports.view only, above.
  "reports.export": ["ADMIN", "OWNER", "MANAGER", "ACCOUNTANT", "AUDIT_VIEWER"],
  "activity.view": ["ADMIN", "OWNER", "MANAGER"],
} as const satisfies Record<string, readonly Role[]>;

/**
 * Roles an OWNER may assign or manage. He runs his own establishment, so he can
 * never mint an ADMIN (cross-tenant) or another OWNER (his own peer) — that
 * stays with the LIS operator.
 */
export const OWNER_ASSIGNABLE_ROLES = [
  "MANAGER",
  "STAFF",
  "ACCOUNTANT",
  "AUDIT_VIEWER",
  "AUDIT_VIEWER_LIMITED",
] as const;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/**
 * The bottle weights actually in force for one catalog row.
 *
 * A client weighs their own bottles into their LOCAL catalog row; the master
 * ItemVariant is LIS's library and is shared by every tenant (client decision
 * 2026-07-25). So the local override wins, then the master, then — for density
 * only — the item's category default.
 *
 * Deliberately NOT in weighing.ts: that file is part of the sacred
 * reconciliation path, and this is a lookup rule, not math.
 */
export function resolveBottleWeights(
  local: { tareWeight?: number | null; tareWeightUnit?: string | null; densityFactor?: number | null },
  variant: { tareWeight?: number | null; tareWeightUnit?: string | null; densityFactor?: number | null },
  categoryDensity?: number | null,
): { tareWeight: number | null; tareWeightUnit: string | null; densityFactor: number | null; fromLocal: boolean } {
  const tare = local.tareWeight ?? variant.tareWeight ?? null;
  const density = local.densityFactor ?? variant.densityFactor ?? categoryDensity ?? null;
  return {
    tareWeight: tare,
    // The unit belongs with the number it describes — an override weighed in
    // grams must not inherit the master's "oz" and silently mis-convert.
    tareWeightUnit:
      local.tareWeight != null ? (local.tareWeightUnit ?? null) : (variant.tareWeightUnit ?? null),
    densityFactor: density,
    fromLocal: local.tareWeight != null || local.densityFactor != null,
  };
}

/**
 * Whether a catalog row is still missing a price.
 *
 * An Asset is never sold, so it has no retail price to be missing — requiring
 * one pinned every asset location at "70 items need attention" with no way to
 * clear it short of inventing selling prices for fire extinguishers. Cost is
 * still required: the asset register and every valuation are priced from it.
 */
export function isMissingPrice(
  row: { cost: number; retail: number },
  productType: string | null | undefined,
): boolean {
  if (productType === "Asset") return row.cost <= 0;
  return row.cost <= 0 || row.retail <= 0;
}

/**
 * The reports a 3rd-party audit-service viewer may open (client req 2026-07-28).
 *
 * These accounts exist to read the reconciliation and nothing else — they are
 * not running the establishment, so Sales, Purchases, Transfers, Par Level,
 * Top Sellers and the asset register are noise to them and commercially
 * sensitive to the client. The paid and unpaid tiers see the SAME list; what
 * separates them is downloading, enforced by `reports.export` and the billing
 * lockout, not by hiding reports. Withholding the numbers entirely from an
 * unpaid client removes their reason to settle up.
 *
 * Slugs match the report route segment (`/reports/<slug>`).
 */
export const AUDIT_VIEWER_REPORTS = [
  "full-audit",
  "legacy-audit",
  "usage-cost",
  "cost-snapshot",
  "cost-analysis",
] as const;

/** Audit-service viewers, paid and unpaid — read-only 3rd-party report readers. */
export function isAuditViewer(role: Role): boolean {
  return role === "AUDIT_VIEWER" || role === "AUDIT_VIEWER_LIMITED";
}

/**
 * May this role open this report? Everyone who runs the establishment sees the
 * full set; audit-service viewers are narrowed to the reconciliation.
 */
export function canViewReport(role: Role, slug: string): boolean {
  if (!can(role, "reports.view")) return false;
  if (!isAuditViewer(role)) return true;
  return (AUDIT_VIEWER_REPORTS as readonly string[]).includes(slug);
}

