/**
 * Stage 4 — the per-location catalog: LocationItem.
 *
 * Cost, retail, and the per-VENUE weight overrides. The global ItemVariant is
 * shared by every tenant, so a venue's own tare/density must land here — a
 * client editing the shared variant would silently rewrite other tenants'
 * numbers, which is why those override columns exist at all.
 */
import type { Stage } from "../../import-legacy";
import { gramsFromOz } from "../../../prisma/bootstrap";
import { query } from "../source";
import { loadMap, record } from "../map";
import { migratedLocations } from "./tenancy";
import { densityFor, mapUom, unmappableReason } from "../units";

type LegacyClientBottle = {
  client_bottle_id: number;
  bottle_id: number;
  branch_id: number;
  bottle_size: number;
  bottle_uom: string | null;
  tare_weight: string | number | null;
  liquid_weight: string | number | null;
  default_cost: string | number | null;
  default_retail: string | number | null;
  is_deleted: number;
};

const variantKey = (bottleId: number, size: number, uom: string) => `${bottleId}|${size}|${uom.toLowerCase()}`;

export const pricingStage: Stage = {
  name: "pricing",
  touched: migratedLocations,
  async run(tx, report) {
    const branchMap = await loadMap(tx, "branches");
    const bottleMap = await loadMap(tx, "bottles");
    const variantMap = await loadMap(tx, "bottle_sizes");
    if (branchMap.size === 0 || bottleMap.size === 0) {
      throw new Error(
        [
          "Missing prerequisites in LegacyMap. Run these first, with --confirm:",
          "  --stage=reference   --stage=tenancy   --stage=catalog",
        ].join("\n"),
      );
    }

    const rows = query<LegacyClientBottle>(`
      SELECT JSON_OBJECT(
        'client_bottle_id', client_bottle_id, 'bottle_id', bottle_id, 'branch_id', branch_id,
        'bottle_size', bottle_size, 'bottle_uom', bottle_uom,
        'tare_weight', tare_weight, 'liquid_weight', liquid_weight,
        'default_cost', default_cost, 'default_retail', default_retail,
        'is_deleted', is_deleted
      ) FROM client_bottles
      -- Ordering decides which row wins a collision, so it encodes two rules:
      --
      --   branch_id      — 73 before 74, so the Mansion merge keeps 73's pricing.
      --   is_deleted ASC — an ACTIVE row beats a soft-deleted one. Legacy already
      --                    made this call: of the 11 same-branch duplicate groups
      --                    that contain an active row, the active row is the newer
      --                    one in 11 of 11 cases, and the older one is flagged
      --                    deleted. Ordering by id alone kept the DELETED row and
      --                    with it a superseded price (Knorr Seasoning at 223.00
      --                    instead of 322.14, Lea & Perrins at 1698.00 instead of
      --                    450.00). The data answers this; do not guess it.
      --   id DESC        — among equally-active (or equally-deleted) rows, the
      --                    most recent entry is the current one.
      ORDER BY branch_id, is_deleted ASC, client_bottle_id DESC
    `);

    // (locationId|variantId) already written in this run. TWO different things
    // land here and they must not be conflated:
    //   1. the Mansion 73/74 merge — expected, by design
    //   2. duplicate rows inside ONE branch, which legacy allows and which carry
    //      CONFLICTING COSTS (Knorr Seasonig at branch 87 exists twice, 322.14
    //      and 223.00). Keeping the first is a valuation decision made by row
    //      order, so it gets flagged rather than buried in a skip count.
    const placed = new Map<string, { branch: number; clientBottleId: number; cost: number }>();
    let costConflicts = 0;

    for (const r of rows) {
      const locationId = branchMap.get(String(r.branch_id));
      if (!locationId) {
        report.skip("branch-not-migrated", `client_bottle_id ${r.client_bottle_id} on branch ${r.branch_id}`);
        continue;
      }

      let unitName: string | null;
      try {
        unitName = mapUom(r.bottle_uom);
      } catch (e) {
        throw new Error(`client_bottle_id ${r.client_bottle_id}: ${(e as Error).message}`);
      }
      if (unitName === null) {
        report.skip(
          "unmappable-uom",
          `client_bottle_id ${r.client_bottle_id} uom "${r.bottle_uom}" — ${unmappableReason(r.bottle_uom)}`,
        );
        continue;
      }

      const itemId = bottleMap.get(String(r.bottle_id));
      if (!itemId) {
        report.skip("bottle-not-imported", `client_bottle_id ${r.client_bottle_id} -> bottle_id ${r.bottle_id}`);
        continue;
      }

      // Same normalisation as the catalog stage, or the keys will not line up.
      const rawSize = Number(r.bottle_size ?? 0);
      const size = rawSize > 0 ? rawSize : 1;
      const key = variantKey(r.bottle_id, size, unitName);

      const tareOz = Number(r.tare_weight ?? 0);
      const liquidPerOz = Number(r.liquid_weight ?? 0);

      let variantId = variantMap.get(key);
      if (!variantId) {
        // 38 distinct (bottle, size, uom) combos exist in client_bottles but NOT
        // in bottle_sizes — legacy data drift, all of them size-0 kitchen goods
        // (flour, salt, milk, oils). They are referenced by 28 audits and 11
        // sales, so skipping them would silently lose real transactions in the
        // counts and transactions stages. Create the variant from the row that
        // proves it exists, and say so.
        const unit = await tx.unit.findUnique({ where: { name: unitName }, select: { id: true } });
        if (!unit) throw new Error(`Unit "${unitName}" does not exist — run db:bootstrap first.`);
        const created = await tx.itemVariant.create({
          data: {
            itemId,
            size,
            unitId: unit.id,
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
          contentTracked: tareOz > 0 || size > 1,
            tareWeight: tareOz > 0 ? gramsFromOz(tareOz) : null,
            tareWeightUnit: tareOz > 0 ? "g" : null,
            densityFactor: densityFor(liquidPerOz),
          },
          select: { id: true },
        });
        variantId = created.id;
        variantMap.set(key, variantId);
        await record(tx, "bottle_sizes", key, variantId);
        report.count("ItemVariant (created from client_bottles)");
      }

      const placedKey = `${locationId}|${variantId}`;
      const prior = placed.get(placedKey);
      const thisCost = Number(r.default_cost ?? 0);
      if (prior) {
        if (prior.branch !== r.branch_id) {
          report.skip(
            "mansion-merge-duplicate-catalog",
            `client_bottle_id ${r.client_bottle_id} (branch ${r.branch_id}) — branch ${prior.branch} ` +
              `already placed this variant at the merged location; its pricing was kept`,
          );
        } else {
          const differs = Math.abs(prior.cost - thisCost) > 0.001;
          report.skip(
            "legacy-duplicate-catalog-row",
            `client_bottle_id ${r.client_bottle_id} duplicates ${prior.clientBottleId} on branch ` +
              `${r.branch_id}: cost ${thisCost} vs kept ${prior.cost}${differs ? " — DIFFERENT" : ""}`,
          );
          if (differs) costConflicts += 1;
        }
        // Record the losing row against the winning LocationItem, the same way a
        // deduplicated menu maps onto its survivor. Both legacy rows genuinely
        // describe that one catalog entry — one superseded the other — so the
        // mapping is provenance, and recording it keeps a from-scratch run and a
        // re-run in the same state.
        const winner = await tx.locationItem.findUnique({
          where: { locationId_itemVariantId: { locationId, itemVariantId: variantId } },
          select: { id: true },
        });
        if (winner) await record(tx, "client_bottles", r.client_bottle_id, winner.id);
        continue;
      }
      placed.set(placedKey, { branch: r.branch_id, clientBottleId: r.client_bottle_id, cost: thisCost });

      const existing = await tx.locationItem.findUnique({
        where: { locationId_itemVariantId: { locationId, itemVariantId: variantId } },
        select: { id: true },
      });

      const data = {
        cost: Number(r.default_cost ?? 0),
        retail: Number(r.default_retail ?? 0),
        // Per-VENUE overrides, not the global variant. Same oz -> g conversion
        // and the same 0-means-null rule as the catalog stage.
        tareWeight: tareOz > 0 ? gramsFromOz(tareOz) : null,
        tareWeightUnit: tareOz > 0 ? "g" : null,
        densityFactor: densityFor(liquidPerOz),
        isActive: Number(r.is_deleted) !== 1,
      };

      if (existing) {
        await tx.locationItem.update({ where: { id: existing.id }, data });
        await record(tx, "client_bottles", r.client_bottle_id, existing.id);
        report.count("LocationItem (updated)");
      } else {
        const created = await tx.locationItem.create({
          data: { locationId, itemVariantId: variantId, ...data },
          select: { id: true },
        });
        await record(tx, "client_bottles", r.client_bottle_id, created.id);
        report.count("LocationItem (created)");
      }
    }

    if (costConflicts > 0) {
      report.flag(
        `${costConflicts} duplicate catalog row(s) inside a single branch carry DIFFERENT costs ` +
          `(e.g. Knorr Seasonig at branch 87: 322.14 and 223.00). The lower client_bottle_id was ` +
          `kept, which is row order, not a decision. Cost feeds valuation and the Full Audit's ` +
          `cost columns — list them from the "legacy-duplicate-catalog-row" skips above and have ` +
          `someone say which price is right.`,
      );
    }
  },
};
