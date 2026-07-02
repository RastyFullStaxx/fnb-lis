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

export function formatQty(qty: number, unitName?: string): string {
  const n = QTY_FORMAT.format(qty);
  return unitName ? `${n} ${unitName}` : n;
}
