import { resolveExportUnit, type UnitDef } from "@fnb/core";
import { prisma } from "../db";

/**
 * Establishment unit defaults for a batch of items, keyed by itemId.
 * Server-side twin of the client's item-display-units lookup
 * (routes/settings.ts GET /item-display-units), but reads only
 * ClientItemUnitDefault — no UserItemUnitPreference — since export never
 * uses a staff member's personal levels. See report-uom-plan.md, "On
 * export".
 */
export async function loadExportUnitDefaults(
  clientId: string,
  itemIds: string[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.clientItemUnitDefault.findMany({
    where: { clientId, itemId: { in: [...new Set(itemIds)] } },
    select: { itemId: true, unit: true },
  });
  return new Map(rows.map((r) => [r.itemId, r.unit]));
}

/**
 * Resolves the export display unit for one item, given the establishment
 * defaults already loaded by loadExportUnitDefaults(). Thin wrapper around
 * resolveExportUnit() so call sites don't rebuild the levels object by
 * hand at every report row.
 */
export function exportUnitFor(
  itemId: string,
  defaults: Map<string, string>,
  itemUnit: Pick<UnitDef, "name" | "kind">,
): string {
  return resolveExportUnit({ adminDefault: defaults.get(itemId) ?? null }, itemUnit).unit;
}

/**
 * report-uom-phases.md Phase 5: batched itemId/unit lookup by locationItemId,
 * for reports built from ReconRow (Usage Cost, Sales By Item) rather than a
 * direct LocationItem query. ReconRow only carries `unitName`/`size` (the
 * fixed catalog label) — reconciliation.ts is formula-only and out of scope
 * for this plan, so itemId/unitKind/unitFactorToBase are looked up here
 * instead of widened onto ReconRow itself. Same shape as
 * loadExportUnitDefaults()'s batching, one query for every row a report
 * needs rather than one query per row.
 */
export async function loadLocationItemUnits(
  locationItemIds: string[],
): Promise<Map<string, { itemId: string; unitName: string; unitKind: "VOLUME" | "MASS" | "COUNT"; unitFactorToBase: number }>> {
  if (locationItemIds.length === 0) return new Map();
  const rows = await prisma.locationItem.findMany({
    where: { id: { in: [...new Set(locationItemIds)] } },
    select: {
      id: true,
      itemVariant: { select: { itemId: true, unit: { select: { name: true, kind: true, factorToBase: true } } } },
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        itemId: r.itemVariant.itemId,
        unitName: r.itemVariant.unit.name,
        unitKind: r.itemVariant.unit.kind as "VOLUME" | "MASS" | "COUNT",
        unitFactorToBase: r.itemVariant.unit.factorToBase,
      },
    ]),
  );
}
