/**
 * Legacy vocabulary -> rebuild vocabulary. Pure data and lookups, no I/O.
 *
 * Everything here throws rather than defaulting. A migration that quietly
 * substitutes a plausible value for one it did not recognise produces a database
 * that is wrong in a way nothing reports.
 */
import { densityPerGram } from "../../prisma/bootstrap";

/**
 * Legacy `bottle_uom` is free text and does not match Unit.name.
 *
 * Verified against the UNION of every table that carries a bottle_uom
 * (bottle_sizes, client_bottles, bottle_tare_weights, bottle_liquid_weights,
 * client_bottle_audits, client_sales, purchase_items, client_menus_ingridients,
 * client_forfeited_bottles, client_bottle_inventory) — 22 distinct values.
 *
 * An earlier version of this table claimed to be exhaustive from client_bottles
 * alone, which is 14 values. The catalog stage then threw on "kilo", present
 * only in bottle_sizes. That throw is the design working: it is exactly the
 * failure that a permissive default would have hidden.
 *
 * THREE outcomes, not two:
 *   - a real mapping           -> the Unit name
 *   - a known-unmappable value -> null, and the caller SKIPS AND REPORTS the row
 *   - anything else            -> throws
 *
 * The middle case matters. "fl" appears on an item literally named "00 Flour",
 * so it abbreviates FLOUR, not fluid ounce; mapping it to "fl oz" would put a
 * volume unit on a dry good. Skipping a row and naming it in the report is
 * honest. Inventing a unit for it is not.
 */
export const UOM_MAP: Record<string, string> = {
  ml: "ml",           // 1,525
  kg: "kg",           //   364
  grams: "g",         //    75
  liter: "L",         //    58
  bottle: "bottle",   //    37
  piece: "pc",        //    33  — NOT "Piece", which is asset-register vocabulary
  can: "can",         //    28
  pack: "pack",       //    25
  portion: "portion", //     5  — added by db:bootstrap
  oz: "oz",           //     2
  case: "case",       //     1
  box: "box",         //     1
  order: "order",     //     1  — added by db:bootstrap
  mil: "ml",          //     1  — typo, normalised
  kilo: "kg",         //     2  — bottle_sizes only; unambiguous
};

/**
 * Present in the data, deliberately NOT mapped. Callers skip the row and report
 * it by legacy id. Each is a judgement recorded once, here, rather than in the
 * stage that happens to hit it first.
 */
export const UNMAPPABLE_UOMS: Record<string, string> = {
  fl: 'abbreviates FLOUR (appears on "00 Flour"), not fluid ounce — 4 rows, 3 of them test data',
  tub: 'a container, not a unit — 1 row, on an item named "Ice Cram"',
  "": "blank/NULL uom — 1 row (Johnnie Walker Black, size 0, which has proper variants elsewhere)",
  // Sales-only values, listed so the transactions stage does not rediscover them:
  yield: "2,554 client_sales rows. NOT a unit — a legacy sales concept. Must be resolved before the transactions stage.",
  "-": "14 client_sales rows, placeholder text",
  bar: "236 rows, weight-lookup tables only — never joined as a unit",
  "1": "190 rows, bottle_liquid_weights only — never joined as a unit",
};

/** Returns the Unit name, or null when the value is known-unmappable. Throws otherwise. */
export function mapUom(raw: string | null | undefined): string | null {
  const key = (raw ?? "").trim().toLowerCase();
  const mapped = UOM_MAP[key];
  if (mapped) return mapped;
  if (key in UNMAPPABLE_UOMS) return null;
  throw new Error(
    `Unknown legacy bottle_uom "${raw}". Decide deliberately: add it to UOM_MAP (and add the ` +
      `Unit in prisma/bootstrap.ts if it does not exist), or add it to UNMAPPABLE_UOMS with the ` +
      `reason. Do not let the importer invent a Unit.`,
  );
}

/** Why a known-unmappable value was skipped, for the report. */
export function unmappableReason(raw: string | null | undefined): string {
  return UNMAPPABLE_UOMS[(raw ?? "").trim().toLowerCase()] ?? "unknown";
}

/**
 * Legacy `category_type`: 1 = food (12 rows), 2 = beverage (33).
 * No type-3 rows exist — cocktails live only in client_menus, never as a category.
 */
export function productTypeFor(categoryType: number): string {
  if (categoryType === 1) return "Food";
  if (categoryType === 2) return "Beverage";
  throw new Error(`Unexpected legacy category_type ${categoryType} — only 1 and 2 exist in this dump.`);
}

/**
 * Density, converted and guarded.
 *
 * TWO things happen here and both matter:
 *
 * 1. `0.00` means "not weighable", NOT "density zero". Thirty-five of the 45
 *    legacy categories carry 0.00 (only the 10 true spirits have a real value).
 *    Importing 0 literally would make every weigh count on those categories
 *    compute (scale - tare) x 0 = 0 ml — a total, silent loss of open-container
 *    content that integrity_check and every type check would pass. Null is the
 *    "derived, not configured" fallback resolveDensityFactor already expects.
 *
 * 2. Legacy is ml-per-OUNCE (Vodka 30.12); this database stores ml-per-GRAM
 *    (Vodka 1.0625 — see seed.ts and prisma/bootstrap.ts). Returning the raw
 *    legacy number is the single most damaging thing this file could do.
 *
 * The 10 legacy values match the seeded ones exactly once converted, which is
 * where architecture.md §6's "seeded from legacy fnb.sql" came from.
 */
export function densityFor(liquidWeightPerOz: number): number | null {
  return liquidWeightPerOz > 0 ? densityPerGram(liquidWeightPerOz) : null;
}
