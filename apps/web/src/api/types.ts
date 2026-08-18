// Response shapes for the REST API (server includes noted relations).

import type { PaymentTerms } from "@fnb/core";

export interface Unit {
  id: string;
  name: string;
  kind: "VOLUME" | "MASS" | "COUNT";
  factorToBase: number;
  isSystem: boolean;
}

export interface Category {
  id: string;
  name: string;
  productType: string;
  defaultDensityFactor: number | null;
  sortOrder: number;
  // Asset-only, nullable (client req 2026-07-24). One industry per category.
  industry: string | null;
  // Whether items in this category spoil by default (expiry-date-plan.md).
  // Read through resolveIsPerishable(), never compared directly —
  // LocationItem.isPerishable below can override it per establishment.
  defaultPerishable: boolean;
  _count?: { items: number };
}

export interface ItemVariant {
  id: string;
  itemId: string;
  size: number;
  unitId: string;
  contentTracked: boolean;
  /** null = legacy inference (contentTracked ⇒ DENSITY); NET = kitchen net-weight counting. */
  weighMode: "DENSITY" | "NET" | null;
  tareWeight: number | null;
  tareWeightUnit: "g" | "oz" | null;
  densityFactor: number | null;
  barcode: string | null;
  /** Open "this weight looks wrong" report from a client (client req 2026-07-25). */
  weightReviewNote: string | null;
  weightReviewBy: string | null;
  weightReviewAt: string | null;
  // Asset-only (architecture.md deviation #21).
  brand: string | null;
  model: string | null;
  isActive: boolean;
  unit: Unit;
}

export interface Item {
  id: string;
  name: string;
  categoryId: string;
  description: string | null;
  isActive: boolean;
  category: Category;
  variants: ItemVariant[];
}

export interface AvailableVariant extends ItemVariant {
  item: Item;
}

export interface LocationItem {
  id: string;
  locationId: string;
  itemVariantId: string;
  cost: number;
  retail: number;
  parLevel: number | null;
  /** The client's own weighing of THEIR bottle — wins over the shared master
      variant (client decision 2026-07-25). Null = use the master. */
  tareWeight: number | null;
  tareWeightUnit: "g" | "oz" | null;
  densityFactor: number | null;
  isActive: boolean;
  // Asset-only (architecture.md deviation #21), filled in post-attach via
  // the Local Database edit surface (Phase 5).
  initialCost: number | null;
  serialNo: string | null;
  condition: string | null;
  status: string | null;
  remarks: string | null;
  assetCode: string | null;
  /** Per-location override of Category.defaultPerishable. Null = inherit the
      category default (expiry-date-plan.md). Read through resolveIsPerishable(). */
  isPerishable: boolean | null;
  /** Oldest open (ACTIVE, on a COMMITTED purchase) expiry date across every
      dated batch for this row, or null if none. Only present on the catalog
      list response (GET /location-items) — the attach/update mutations don't
      compute it, since a just-attached or just-priced row has no purchase
      history to aggregate. Compare with isExpiryDatePast(), which treats
      missing the same as null (expiry-date-plan.md, phases doc Phase 5.1). */
  earliestOpenExpiry?: string | null;
  itemVariant: ItemVariant & { item: Item };
}

export interface Supplier {
  id: string;
  clientId: string;
  name: string;
  contactInfo: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: PaymentTerms | null;
  isActive: boolean;
}

/** Display label for a variant, e.g. "700 ml" or "1 pack". */
export function variantLabel(v: { size: number; unit: { name: string } }): string {
  return `${v.size} ${v.unit.name}`;
}

// ── Operational records ──

interface AuditFields {
  status: string;
  voidedAt: string | null;
  voidReason: string | null;
  correctionOfId: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface CountSession {
  id: string;
  locationId: string;
  countDate: string;
  name: string | null;
  status: "OPEN" | "COMMITTED" | "VOID";
  note: string | null;
  createdByName: string;
  createdAt: string;
  committedAt: string | null;
  voidReason: string | null;
  /**
   * The machine that opened this count, or null for the web app. While the
   * session is OPEN this is also its OWNER — the server refuses edits from
   * anywhere else (docs/sync-and-data-lifecycle.md §7.2, Rule 1).
   */
  originDeviceId: string | null;
  _count?: { lines: number };
}

export interface CountLine extends AuditFields {
  id: string;
  countSessionId: string;
  locationItemId: string;
  countType: "FULL" | "WEIGH";
  qtyFull: number;
  scaleWeight: number | null;
  scaleUnit: string | null;
  tareWeight: number | null;
  densityFactor: number | null;
  remainingContent: number;
  unitCost: number;
  unitRetail: number;
  locationItem: LocationItem;
}

export interface Purchase {
  id: string;
  locationId: string;
  supplierId: string | null;
  supplier: Supplier | null;
  refNo: string | null;
  purchaseDate: string;
  status: "DRAFT" | "COMMITTED" | "VOID";
  note: string | null;
  createdByName: string;
  createdAt: string;
  voidReason: string | null;
  lineCount?: number;
  total?: number;
}

export interface PurchaseLine extends AuditFields {
  id: string;
  purchaseId: string;
  locationItemId: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
  /** The date on the box, entered at receiving (expiry-date-plan.md). Null for
      non-perishable lines and for lines written before this column existed. */
  expiryDate: string | null;
  locationItem: LocationItem;
}

export interface Transfer {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  fromLocation?: { id: string; name: string; kind: string | null };
  toLocation?: { id: string; name: string; kind: string | null };
  businessDate: string;
  status: "DRAFT" | "COMMITTED" | "VOID";
  note: string | null;
  createdByName: string;
  createdAt: string;
  voidReason: string | null;
  lineCount?: number;
  total?: number;
  /** Active lines that already have an active receipt (list endpoint only). */
  receivedCount?: number;
}

export interface TransferReceipt {
  id: string;
  qtyReceived: number;
  receiptDate: string;
  note: string | null;
}

export interface TransferLine extends AuditFields {
  id: string;
  transferId: string;
  locationItemId: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
  locationItem: LocationItem;
  receipts: TransferReceipt[];
}

export interface SaleRecord extends AuditFields {
  id: string;
  locationId: string;
  saleDate: string;
  kind: "SALE" | "NON_REVENUE" | "PRODUCTION";
  locationItemId: string | null;
  menuItemId: string | null;
  qty: number;
  unitPrice: number;
  discountPct: number;
  contentOverride: number | null;
  reason: string | null;
  note: string | null;
  locationItem: LocationItem | null;
  menuItem: { id: string; name: string } | null;
}

export interface Forfeit extends AuditFields {
  id: string;
  locationId: string;
  forfeitDate: string;
  locationItemId: string;
  scaleWeight: number | null;
  scaleUnit: string | null;
  tareWeight: number | null;
  densityFactor: number | null;
  remainingContent: number;
  qty: number;
  note: string | null;
  locationItem: LocationItem;
}

/** One open perishable delivery batch — the count screen's FIFO worklist
    (expiry-date-plan.md, phases doc Phase 4). */
export interface FifoBatch {
  id: string;
  qty: number;
  expiryDate: string;
  purchaseDate: string;
}
