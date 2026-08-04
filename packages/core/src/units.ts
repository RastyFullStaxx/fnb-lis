export type UnitKind = "VOLUME" | "MASS" | "COUNT";

/** Base units per kind: VOLUME → ml, MASS → g, COUNT → 1. */
export interface UnitDef {
  id: string;
  name: string;
  kind: UnitKind;
  factorToBase: number;
}

export class UnitKindMismatchError extends Error {
  constructor(from: UnitDef, to: UnitDef) {
    super(`Cannot convert ${from.name} (${from.kind}) to ${to.name} (${to.kind})`);
    this.name = "UnitKindMismatchError";
  }
}

export function toBase(qty: number, unit: UnitDef): number {
  return qty * unit.factorToBase;
}

export function convert(qty: number, from: UnitDef, to: UnitDef): number {
  if (from.kind !== to.kind) throw new UnitKindMismatchError(from, to);
  return (qty * from.factorToBase) / to.factorToBase;
}

const QTY_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * Client req 2026-07-31: the values a user's preferredVolumeUnit /
 * preferredMassUnit preference can hold, and the factorToBase each one
 * needs to actually call `convert()`. These must match seed.ts's VOLUME
 * and MASS rows exactly — this is not a second source of truth, it is the
 * same four-and-four list, copied here because the preference is a plain
 * string (userPreferences in routes/settings.ts), not a Unit row with an
 * id, so it cannot be looked up by id like a variant's own unit can.
 */
export const PREFERENCE_UNITS: Record<string, { kind: UnitKind; factorToBase: number }> = {
  ml: { kind: "VOLUME", factorToBase: 1 },
  L: { kind: "VOLUME", factorToBase: 1000 },
  "fl oz": { kind: "VOLUME", factorToBase: 29.5735 },
  gal: { kind: "VOLUME", factorToBase: 3785.41 },
  g: { kind: "MASS", factorToBase: 1 },
  kg: { kind: "MASS", factorToBase: 1000 },
  oz: { kind: "MASS", factorToBase: 28.3495 },
  lb: { kind: "MASS", factorToBase: 453.592 },
};

/**
 * Builds a UnitDef for a preference string so it can be passed to
 * `convert()` alongside the item's own UnitDef. `id` is not meaningful
 * here (no Unit row backs a preference) — only kind and factorToBase
 * matter for the conversion math and the kind-mismatch guard.
 */
export function preferredUnitDef(name: string): UnitDef | null {
  const entry = PREFERENCE_UNITS[name];
  if (!entry) return null;
  return { id: name, name, kind: entry.kind, factorToBase: entry.factorToBase };
}

/**
 * Which unit a number is *displayed* in for one (user, item) pair.
 *
 * Client req 2026-07-31 (docs/per-user-per-item-uom-plan.md): admins set a
 * default unit per item, staff can override it for themselves per item, and
 * both sit above the staff's own general preferredVolumeUnit/preferredMassUnit
 * and the item's own base unit. Most specific wins:
 *
 *   1. staffOverride   — UserItemUnitPreference for this (user, item)
 *   2. adminDefault    — ClientItemUnitDefault for this (client, item)
 *   3. staffPreference — preferredVolumeUnit / preferredMassUnit (by kind)
 *   4. itemBaseUnit    — the item's own configured unit (ml / g / …)
 *
 * Same shape as `resolveBottleWeights`: a lookup rule over already-loaded
 * values, not I/O — callers pass in whatever each level resolved to (or
 * null/undefined if nothing was ever set) and get back the unit name plus
 * which level supplied it. Deliberately NOT in weighing.ts or units.ts's
 * convert()/toBase() path: this never changes what a quantity IS, only what
 * unit a caller chooses to render it in via `convert()` afterward.
 */
export type DisplayUnitSource = "staffOverride" | "adminDefault" | "staffPreference" | "itemBaseUnit";

export function resolveDisplayUnit(
  levels: {
    staffOverride?: string | null;
    adminDefault?: string | null;
    staffPreference?: string | null;
  },
  itemBaseUnit: string,
): { unit: string; source: DisplayUnitSource } {
  if (levels.staffOverride) return { unit: levels.staffOverride, source: "staffOverride" };
  if (levels.adminDefault) return { unit: levels.adminDefault, source: "adminDefault" };
  if (levels.staffPreference) return { unit: levels.staffPreference, source: "staffPreference" };
  return { unit: itemBaseUnit, source: "itemBaseUnit" };
}

/**
 * Display only — never feeds a calculation.
 *
 * Snaps float dust to zero first: a variance of -8.9e-16 was printing as "-0",
 * which reads as a real (if tiny) shortage. Below half of the last shown digit
 * it can only render as 0, so this drops the misleading sign and nothing else.
 */
export function formatQty(qty: number, unitName?: string): string {
  const n = QTY_FORMAT.format(Math.abs(qty) < 0.005 ? 0 : qty);
  return unitName ? `${n} ${unitName}` : n;
}
