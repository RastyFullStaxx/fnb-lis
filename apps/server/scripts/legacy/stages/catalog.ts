/**
 * Stage 3 — the global catalog: Item + ItemVariant, with weights.
 *
 * This is the master catalog every location draws from, so it is deliberately
 * NOT per-client. Per-location price and per-venue weight overrides land in the
 * pricing stage against LocationItem.
 */
import type { Stage } from "../../import-legacy";
import { gramsFromOz } from "../../../prisma/bootstrap";
import { query } from "../source";
import { loadMap, record } from "../map";
import { densityFor, mapUom, unmappableReason } from "../units";

type LegacyBottle = {
  bottle_id: number;
  bottle_name: string;
  category_id: number;
  is_deleted: number;
};

type LegacySize = {
  bottle_size_id: number;
  bottle_id: number;
  bottle_size: number;
  bottle_uom: string;
  tare_weight: string | number | null;
  alt_tare: string | number | null;
  liquid_weight: string | number | null;
};

/** Legacy key for a variant. bottle_size_id is not stable across the two tare sources. */
const variantKey = (bottleId: number, size: number, uom: string) => `${bottleId}|${size}|${uom.toLowerCase()}`;

export const catalogStage: Stage = {
  name: "catalog",
  async run(tx, report) {
    const categoryMap = await loadMap(tx, "categories");
    if (categoryMap.size === 0) {
      // Each stage commits in its OWN transaction, so a dry run of an earlier
      // stage rolls back and leaves nothing for this one to resolve. Without
      // this guard the report reads "2,456 skipped" — which looks like a data
      // problem and is actually just stage order. Fail loudly instead.
      throw new Error(
        [
          "No categories in LegacyMap. Run the reference stage FIRST:",
          "  npm run import:legacy -w @fnb/server -- --stage=reference --confirm",
          "(A full --dry-run cannot validate later stages for the same reason:",
          " each stage rolls back before the next one reads it.)",
        ].join("\n"),
      );
    }

    // ── Items ─────────────────────────────────────────────────────────────
    const bottles = query<LegacyBottle>(`
      SELECT JSON_OBJECT('bottle_id', bottle_id, 'bottle_name', bottle_name,
                         'category_id', category_id, 'is_deleted', is_deleted)
      FROM bottles ORDER BY bottle_id
    `);

    const itemIdByLegacy = new Map<string, string>();

    for (const b of bottles) {
      const categoryId = categoryMap.get(String(b.category_id));
      if (!categoryId) {
        // Expect zero of these — the reference stage imports all 45 categories.
        report.skip("unmapped-category", `bottle ${b.bottle_id} "${b.bottle_name}" -> category_id ${b.category_id}`);
        continue;
      }
      const name = (b.bottle_name ?? "").trim() || `(unnamed bottle ${b.bottle_id})`;
      const existingId = await loadOrNull(tx, "bottles", b.bottle_id);

      let itemId: string;
      if (existingId) {
        itemId = existingId;
        report.count("Item (matched existing)");
      } else {
        const created = await tx.item.create({
          data: {
            name,
            categoryId,
            // A DELETED bottle is imported, not skipped: it still appears in
            // historical counts, and skipping it would leave the counts stage
            // with an unresolvable reference to something that genuinely existed.
            isActive: Number(b.is_deleted) !== 1,
          },
          select: { id: true },
        });
        itemId = created.id;
        await record(tx, "bottles", b.bottle_id, itemId);
        report.count("Item (created)");
      }
      itemIdByLegacy.set(String(b.bottle_id), itemId);
    }

    // ── Variants ──────────────────────────────────────────────────────────
    //
    // tare comes from bottle_sizes, NOT bottle_tare_weights. Evidence, not
    // preference: the legacy audit form — the screen that actually performs the
    // weighing — reads `bs.tare_weight` (model_auditbottles.php:283). And it is
    // the only source keyed by SIZE: bottle_tare_weights is per (bottle, uom),
    // which cannot represent a 700ml and a 1000ml bottle of the same brand
    // having different empty weights. The two disagree on 33 of 234 overlapping
    // pairs, so this choice is reported rather than assumed.
    const sizes = query<LegacySize>(`
      SELECT JSON_OBJECT(
        'bottle_size_id', s.bottle_size_id,
        'bottle_id',      s.bottle_id,
        'bottle_size',    s.bottle_size,
        'bottle_uom',     s.bottle_uom,
        'tare_weight',    s.tare_weight,
        'alt_tare',       (SELECT t.tare_weight FROM bottle_tare_weights t
                            WHERE t.bottle_id = s.bottle_id AND t.bottle_uom = s.bottle_uom LIMIT 1),
        'liquid_weight',  (SELECT w.liquid_weight FROM bottle_liquid_weights w
                            WHERE w.bottle_id = s.bottle_id AND w.bottle_uom = s.bottle_uom LIMIT 1)
      ) FROM bottle_sizes s ORDER BY s.bottle_id, s.bottle_size, s.bottle_size_id
    `);

    const seen = new Set<string>();
    let tareDisagreements = 0;

    for (const s of sizes) {
      const itemId = itemIdByLegacy.get(String(s.bottle_id));
      if (!itemId) {
        report.skip("size-without-bottle", `bottle_size_id ${s.bottle_size_id} -> bottle_id ${s.bottle_id} (no such bottle)`);
        continue;
      }

      // Three outcomes (units.ts): a Unit name, null for a KNOWN-unmappable
      // value, or a throw for anything unrecognised. An unrecognised UOM stays
      // fatal — that is what caught "kilo", which existed only in bottle_sizes
      // and would otherwise have silently dropped two variants.
      let unitName: string | null;
      try {
        unitName = mapUom(s.bottle_uom);
      } catch (e) {
        throw new Error(`bottle_size_id ${s.bottle_size_id}: ${(e as Error).message}`);
      }
      if (unitName === null) {
        report.skip(
          "unmappable-uom",
          `bottle_size_id ${s.bottle_size_id} uom "${s.bottle_uom}" — ${unmappableReason(s.bottle_uom)}`,
        );
        continue;
      }

      // Legacy `bottle_size` 0 means "no fixed pack size" (626 of 1,251 rows —
      // a kg of chicken, a piece of something). The rebuild's `size` is a pack
      // size where 1 is the identity, matching seed.ts's `{ size: 1, unit: "kg" }`.
      // Storing 0 would put a division-by-zero waiting in openEquiv for anything
      // later marked contentTracked.
      const rawSize = Number(s.bottle_size ?? 0);
      const size = rawSize > 0 ? rawSize : 1;
      if (rawSize === 0) report.count("variant size 0 -> 1");

      const key = variantKey(s.bottle_id, size, unitName);
      if (seen.has(key)) {
        report.skip("duplicate-variant", `bottle_size_id ${s.bottle_size_id} (${s.bottle_id}, ${size}, ${unitName}) — first one kept`);
        continue;
      }
      seen.add(key);

      const tareOz = Number(s.tare_weight ?? 0);
      const altOz = Number(s.alt_tare ?? 0);
      if (tareOz > 0 && altOz > 0 && Math.abs(tareOz - altOz) > 0.001) {
        tareDisagreements += 1;
        report.skip(
          "tare-sources-disagree",
          `bottle ${s.bottle_id} ${size}${unitName}: bottle_sizes=${tareOz} vs bottle_tare_weights=${altOz} (kept bottle_sizes)`,
        );
      }
      // Fall back only when the authoritative source has nothing.
      const effectiveTareOz = tareOz > 0 ? tareOz : altOz;

      const unit = await tx.unit.findUnique({ where: { name: unitName }, select: { id: true } });
      if (!unit) throw new Error(`Unit "${unitName}" does not exist — run db:bootstrap first.`);

      const existing = await tx.itemVariant.findUnique({
        where: { itemId_size_unitId: { itemId, size, unitId: unit.id } },
        select: { id: true },
      });
      if (existing) {
        // Update, do not just match. A re-run against corrected source data (or
        // a corrected rule, as happened with contentTracked) must actually fix
        // the row — an idempotent import that cannot repair anything is only
        // half idempotent. The legacy dump is authoritative for these columns.
        await tx.itemVariant.update({
          where: { id: existing.id },
          data: {
            contentTracked: effectiveTareOz > 0 || size > 1,
            tareWeight: effectiveTareOz > 0 ? gramsFromOz(effectiveTareOz) : null,
            tareWeightUnit: effectiveTareOz > 0 ? "g" : null,
            densityFactor: densityFor(Number(s.liquid_weight ?? 0)),
          },
        });
        await record(tx, "bottle_sizes", key, existing.id);
        report.count("ItemVariant (updated)");
        continue;
      }

      const created = await tx.itemVariant.create({
        data: {
          itemId,
          size,
          unitId: unit.id,
          // NOT `productType === "Beverage"`. Legacy category_type 2 includes
          // Cigarette, Heets, Soda and Local Beer; only 247 of 1,251 variants
          // carry a tare weight at all. This matches seed.ts exactly, which
          // marks contentTracked true for precisely the items that have a
          // tareWeight and false for beer, tonic, cola and juice.
          //
          // It is also what keeps size-0 rows safe: no size-0 row has a tare
          // weight, so none of them is ever divided by.
          // Legacy has NO contentTracked concept: reports.php:819 divides recipe
          // servings by bottle size UNCONDITIONALLY
          //     $shotscontrol += ($loopshot->serving / $audit->bsize) * $qty
          // so reproducing legacy numbers requires the division to happen
          // wherever it would change the answer.
          //
          // Dividing by size 1 is a no-op, so the rule only bites when size > 1:
          //   size > 1  -> MUST be tracked (a 750ml wine poured at 150ml is 0.2
          //                bottles, not 150 units — 81 recipe ingredients hit this)
          //   tare > 0  -> a weighed bottle, tracked regardless
          //   otherwise -> size is 1 and both formulas agree, so leave it false
          //                and keep the semantics honest for cigarettes etc.
          contentTracked: effectiveTareOz > 0 || size > 1,
          // Legacy is on the OUNCE scale (tare median 20.4 for a 750ml bottle);
          // this database stores GRAMS with tareWeightUnit "g" (seed.ts:487).
          // Unconverted, a 750ml bottle computes ~1253 ml of content.
          tareWeight: effectiveTareOz > 0 ? gramsFromOz(effectiveTareOz) : null,
          tareWeightUnit: effectiveTareOz > 0 ? "g" : null,
          // densityFor converts ml-per-OUNCE to ml-per-GRAM and maps 0 -> null
          // ("not weighable", not "density zero"). See units.ts.
          densityFactor: densityFor(Number(s.liquid_weight ?? 0)),
        },
        select: { id: true },
      });
      await record(tx, "bottle_sizes", key, created.id);
      report.count("ItemVariant (created)");
    }

    if (tareDisagreements > 0) {
      report.flag(
        `${tareDisagreements} variant(s) have conflicting tare weights between bottle_sizes and ` +
          `bottle_tare_weights. bottle_sizes was kept — it is what the legacy audit form reads ` +
          `(model_auditbottles.php:283) and the only source keyed by size. Every conflict is listed ` +
          `above under "tare-sources-disagree"; spot-check a few against the physical bottles.`,
      );
    }
  },
};

/** LegacyMap lookup that tolerates a missing row. */
async function loadOrNull(tx: Parameters<Stage["run"]>[0], table: string, legacyId: string | number) {
  const row = await tx.legacyMap.findUnique({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
    select: { newId: true },
  });
  return row?.newId ?? null;
}
