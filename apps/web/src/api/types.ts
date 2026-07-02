// Response shapes for the REST API (server includes noted relations).

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
  tareWeight: number | null;
  tareWeightUnit: "g" | "oz" | null;
  densityFactor: number | null;
  barcode: string | null;
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
  itemVariant: ItemVariant & { item: Item };
}

export interface Supplier {
  id: string;
  clientId: string;
  name: string;
  contactInfo: string | null;
  isActive: boolean;
}

/** Display label for a variant, e.g. "700 ml" or "1 pack". */
export function variantLabel(v: { size: number; unit: { name: string } }): string {
  return `${v.size} ${v.unit.name}`;
}
