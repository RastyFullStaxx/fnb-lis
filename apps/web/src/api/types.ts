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
  isActive: boolean;
  // Asset-only (architecture.md deviation #21), filled in post-attach via
  // the Local Database edit surface (Phase 5).
  initialCost: number | null;
  serialNo: string | null;
  condition: string | null;
  status: string | null;
  industry: string | null;
  remarks: string | null;
  assetCode: string | null;
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
