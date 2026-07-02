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
