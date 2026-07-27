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
