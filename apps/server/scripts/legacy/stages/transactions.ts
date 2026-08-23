/**
 * Stage 7 — sales, purchases and forfeits.
 *
 * The activity side of the reconciliation. Counts (stage 6) give the anchors;
 * these are everything that moved between them.
 */
import type { Stage } from "../../import-legacy";
import { phpRound } from "@fnb/core";
import { query } from "../source";
import { loadMap, record } from "../map";
import { mapUom, unmappableReason } from "../units";
import { migratedLocations } from "./tenancy";

type LegacySale = {
  client_sales_id: number;
  branch_id: number;
  bottle_id: number | null;
  menu_id: number | null;
  bottle_size: number | null;
  bottle_uom: string | null;
  price: string | number | null;
  discount: string | number | null;
  total_quantity: string | number | null;
  item_type: number;
  sales_type: number;
  non_ml: string | number | null;
  is_deleted: number;
  real_date: string | null;
};

type LegacyPurchaseLine = {
  purchase_item_id: number;
  purchase_id: number;
  branch_id: number;
  bottle_id: number;
  bottle_size: number | null;
  bottle_uom: string | null;
  qty: string | number | null;
  cost: string | number | null;
  real_date: string | null;
};

type LegacyForfeit = {
  client_forfeited_id: number;
  branch_id: number;
  bottle_id: number;
  bottle_size: number | null;
  bottle_uom: string | null;
  liquid_weight: string | number | null;
  tare_weight: string | number | null;
  scale_weight: string | number | null;
  remaining_ml: string | number | null;
  qty: string | number | null;
  date_forfeited: string | null;
};

const variantKey = (bottleId: number, size: number, uom: string) => `${bottleId}|${size}|${uom.toLowerCase()}`;

/**
 * architecture.md deviation #4: legacy encoded "production" as a 100% discount.
 * A fragile magic value becomes a typed kind — consumption counted, revenue 0.
 */
function kindFor(row: LegacySale): "SALE" | "NON_REVENUE" | "PRODUCTION" {
  if (Number(row.discount) === 100) return "PRODUCTION";
  return Number(row.sales_type) === 2 ? "NON_REVENUE" : "SALE";
}

export const transactionsStage: Stage = {
  name: "transactions",
  touched: migratedLocations,
  async run(tx, report, adminId) {
    const branchMap = await loadMap(tx, "branches");
    const variantMap = await loadMap(tx, "bottle_sizes");
    const menuMap = await loadMap(tx, "client_menus");
    const versionMap = await loadMap(tx, "client_menus_v1");
    if (branchMap.size === 0 || variantMap.size === 0) {
      throw new Error(
        [
          "Missing prerequisites in LegacyMap. Run these first, with --confirm:",
          "  --stage=reference --stage=tenancy --stage=catalog --stage=pricing --stage=menus",
        ].join("\n"),
      );
    }

    /** Resolve a legacy (bottle, size, uom) to a LocationItem at this location. */
    const findLocationItem = async (
      locationId: string,
      bottleId: number,
      rawSize: number | null,
      uom: string | null,
    ): Promise<{ id: string } | null | "unmappable"> => {
      const unitName = mapUom(uom);
      if (unitName === null) return "unmappable";
      const size = Number(rawSize ?? 0) > 0 ? Number(rawSize) : 1;
      const variantId = variantMap.get(variantKey(bottleId, size, unitName));
      if (!variantId) return null;
      return tx.locationItem.findUnique({
        where: { locationId_itemVariantId: { locationId, itemVariantId: variantId } },
        select: { id: true },
      });
    };

    // ── Sales ─────────────────────────────────────────────────────────────
    const sales = query<LegacySale>(`
      SELECT JSON_OBJECT(
        'client_sales_id', client_sales_id, 'branch_id', branch_id,
        'bottle_id', bottle_id, 'menu_id', menu_id, 'bottle_size', bottle_size,
        'bottle_uom', bottle_uom, 'price', price, 'discount', discount,
        'total_quantity', total_quantity, 'item_type', item_type,
        'sales_type', sales_type, 'non_ml', non_ml, 'is_deleted', is_deleted,
        'real_date', DATE_FORMAT(real_date, '%Y-%m-%d')
      ) FROM client_sales ORDER BY client_sales_id
    `);

    let production = 0;
    let nonRevenue = 0;
    let plainSale = 0;

    for (const s of sales) {
      const locationId = branchMap.get(String(s.branch_id));
      if (!locationId) {
        report.skip("branch-not-migrated", `sale ${s.client_sales_id} on branch ${s.branch_id}`);
        continue;
      }
      const saleDate = (s.real_date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
        // One legacy row has a null real_date. A sale with no business date
        // cannot be placed in any audit period, so it is dropped rather than
        // guessed into one.
        report.skip("sale-without-date", `sale ${s.client_sales_id} real_date=${s.real_date}`);
        continue;
      }
      if (await loadOrNull(tx, "client_sales", s.client_sales_id)) {
        report.count("SaleRecord (matched existing)");
        continue;
      }

      const kind = kindFor(s);
      const isMenu = Number(s.item_type) === 2;

      let locationItemId: string | null = null;
      let menuItemId: string | null = null;
      let recipeVersionId: string | null = null;

      if (isMenu) {
        // A menu sale carries NO bottle: legacy stuffs `bottle_uom = 'yield'`
        // and `bottle_size = 1` into the unused bottle columns as placeholders.
        // 2,552 rows look like that. mapUom is never called on this path —
        // resolving the uom would fail on a value that was never a unit.
        menuItemId = menuMap.get(String(s.menu_id)) ?? null;
        recipeVersionId = versionMap.get(String(s.menu_id)) ?? null;
        if (!menuItemId) {
          report.skip("menu-not-imported", `sale ${s.client_sales_id} -> menu_id ${s.menu_id}`);
          continue;
        }
      } else {
        if (!s.bottle_id) {
          report.skip("item-sale-without-bottle", `sale ${s.client_sales_id}`);
          continue;
        }
        let found: { id: string } | null | "unmappable";
        try {
          found = await findLocationItem(locationId, s.bottle_id, s.bottle_size, s.bottle_uom);
        } catch (e) {
          throw new Error(`sale ${s.client_sales_id}: ${(e as Error).message}`);
        }
        if (found === "unmappable") {
          report.skip("unmappable-uom", `sale ${s.client_sales_id} uom "${s.bottle_uom}" — ${unmappableReason(s.bottle_uom)}`);
          continue;
        }
        if (!found) {
          report.skip("item-not-in-location-catalog", `sale ${s.client_sales_id}: bottle ${s.bottle_id}`);
          continue;
        }
        locationItemId = found.id;
      }

      const created = await tx.saleRecord.create({
        data: {
          locationId,
          saleDate,
          kind,
          // XOR by construction: exactly one of these is ever set.
          locationItemId,
          menuItemId,
          recipeVersionId,
          qty: Number(s.total_quantity ?? 0),
          // Menu rows carry no price in legacy — revenue is derived from the
          // recipe's SRP (architecture.md §6), so 0 here is correct, not missing.
          unitPrice: s.price != null ? Number(s.price) : 0,
          // PRODUCTION already means "revenue 0" as a typed kind. Carrying the
          // legacy 100 as well would re-encode the magic value the deviation
          // exists to remove.
          discountPct: kind === "PRODUCTION" ? 0 : Number(s.discount ?? 0),
          // Schema restricts contentOverride to NON_REVENUE, and the
          // reconciliation EXCLUDES rows with contentOverride > 0 from qty sums.
          // Setting it on a SALE would silently drop that sale from variance.
          contentOverride: kind === "NON_REVENUE" && Number(s.non_ml ?? 0) > 0 ? Number(s.non_ml) : null,
          source: "IMPORT",
          status: Number(s.is_deleted) === 1 ? "VOID" : "ACTIVE",
          createdById: adminId,
          createdByName: "Legacy migration",
        },
        select: { id: true },
      });
      await record(tx, "client_sales", s.client_sales_id, created.id);
      report.count(`SaleRecord ${kind}`);
      if (kind === "PRODUCTION") production++;
      else if (kind === "NON_REVENUE") nonRevenue++;
      else plainSale++;
      if (isMenu && !recipeVersionId) {
        report.skip("menu-sale-without-recipe-version", `sale ${s.client_sales_id} menu_id ${s.menu_id}`);
      }
    }

    // ── Purchases ─────────────────────────────────────────────────────────
    //
    // purchaseDate comes from the LINE's real_date, never the header's
    // date_created: date_created is when the row was typed, real_date is when
    // the delivery happened, and only the latter belongs in an audit period.
    // Verified: no legacy purchase has lines spanning more than one real_date.
    const lines = query<LegacyPurchaseLine>(`
      SELECT JSON_OBJECT(
        'purchase_item_id', pi.purchase_item_id, 'purchase_id', pi.purchase_id,
        'branch_id', p.branch_id, 'bottle_id', pi.bottle_id,
        'bottle_size', pi.bottle_size, 'bottle_uom', pi.bottle_uom,
        'qty', pi.qty, 'cost', pi.cost,
        'real_date', DATE_FORMAT(pi.real_date, '%Y-%m-%d')
      ) FROM purchase_items pi JOIN purchases p ON p.purchase_id = pi.purchase_id
      ORDER BY pi.purchase_id, pi.purchase_item_id
    `);

    const purchaseIds = new Map<string, string>();
    for (const l of lines) {
      const locationId = branchMap.get(String(l.branch_id));
      if (!locationId) {
        report.skip("branch-not-migrated", `purchase_item ${l.purchase_item_id} on branch ${l.branch_id}`);
        continue;
      }
      const purchaseDate = (l.real_date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
        report.skip("purchase-without-date", `purchase_item ${l.purchase_item_id} real_date=${l.real_date}`);
        continue;
      }

      let found: { id: string } | null | "unmappable";
      try {
        found = await findLocationItem(locationId, l.bottle_id, l.bottle_size, l.bottle_uom);
      } catch (e) {
        throw new Error(`purchase_item ${l.purchase_item_id}: ${(e as Error).message}`);
      }
      if (found === "unmappable") {
        report.skip("unmappable-uom", `purchase_item ${l.purchase_item_id} uom "${l.bottle_uom}"`);
        continue;
      }
      if (!found) {
        report.skip("item-not-in-location-catalog", `purchase_item ${l.purchase_item_id}: bottle ${l.bottle_id}`);
        continue;
      }

      const headerKey = `${l.purchase_id}`;
      let purchaseId = purchaseIds.get(headerKey);
      if (!purchaseId) {
        const existing = await loadOrNull(tx, "purchases", l.purchase_id);
        purchaseId =
          existing ??
          (
            await tx.purchase.create({
              data: {
                locationId,
                purchaseDate,
                status: "COMMITTED",
                createdById: adminId,
                createdByName: "Legacy migration",
                committedById: adminId,
                committedAt: new Date(`${purchaseDate}T00:00:00.000Z`),
                note: "Migrated from legacy purchases",
              },
              select: { id: true },
            })
          ).id;
        if (!existing) {
          await record(tx, "purchases", l.purchase_id, purchaseId);
          report.count("Purchase (created)");
        }
        purchaseIds.set(headerKey, purchaseId);
      }

      if (await loadOrNull(tx, "purchase_items", l.purchase_item_id)) {
        report.count("PurchaseLine (matched existing)");
        continue;
      }
      const qty = Number(l.qty ?? 0);
      const unitCost = Number(l.cost ?? 0);
      const createdLine = await tx.purchaseLine.create({
        data: {
          purchaseId,
          locationItemId: found.id,
          qty,
          unitCost,
          // phpRound, never Math.round or toFixed — the project's rounding rule.
          lineTotal: phpRound(qty * unitCost),
          createdById: adminId,
          createdByName: "Legacy migration",
        },
        select: { id: true },
      });
      await record(tx, "purchase_items", l.purchase_item_id, createdLine.id);
      report.count("PurchaseLine (created)");
    }

    // ── Forfeits ──────────────────────────────────────────────────────────
    const forfeits = query<LegacyForfeit>(`
      SELECT JSON_OBJECT(
        'client_forfeited_id', client_forfeited_id, 'branch_id', branch_id,
        'bottle_id', bottle_id, 'bottle_size', bottle_size, 'bottle_uom', bottle_uom,
        'liquid_weight', liquid_weight, 'tare_weight', tare_weight,
        'scale_weight', scale_weight, 'remaining_ml', remaining_ml, 'qty', qty,
        'date_forfeited', DATE_FORMAT(date_forfeited, '%Y-%m-%d')
      ) FROM client_forfeited_bottles ORDER BY client_forfeited_id
    `);

    for (const f of forfeits) {
      const locationId = branchMap.get(String(f.branch_id));
      if (!locationId) {
        report.skip("branch-not-migrated", `forfeit ${f.client_forfeited_id} on branch ${f.branch_id}`);
        continue;
      }
      const forfeitDate = (f.date_forfeited ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(forfeitDate)) {
        report.skip("forfeit-without-date", `forfeit ${f.client_forfeited_id}`);
        continue;
      }
      if (await loadOrNull(tx, "client_forfeited_bottles", f.client_forfeited_id)) {
        report.count("Forfeit (matched existing)");
        continue;
      }
      let found: { id: string } | null | "unmappable";
      try {
        found = await findLocationItem(locationId, f.bottle_id, f.bottle_size, f.bottle_uom);
      } catch (e) {
        throw new Error(`forfeit ${f.client_forfeited_id}: ${(e as Error).message}`);
      }
      if (found === "unmappable" || !found) {
        report.skip("item-not-in-location-catalog", `forfeit ${f.client_forfeited_id}: bottle ${f.bottle_id}`);
        continue;
      }
      const scale = Number(f.scale_weight ?? 0);
      const created = await tx.forfeit.create({
        data: {
          locationId,
          forfeitDate,
          locationItemId: found.id,
          // Ounces, uncoverted, for the same reason as count lines: the row
          // carries its own scale/tare/density and is self-describing.
          scaleWeight: scale > 0 ? scale : null,
          scaleUnit: scale > 0 ? "oz" : null,
          tareWeight: Number(f.tare_weight ?? 0) > 0 ? Number(f.tare_weight) : null,
          densityFactor: Number(f.liquid_weight ?? 0) > 0 ? Number(f.liquid_weight) : null,
          remainingContent: Number(f.remaining_ml ?? 0),
          qty: Number(f.qty ?? 0),
          createdById: adminId,
          createdByName: "Legacy migration",
          note: "Migrated from legacy client_forfeited_bottles",
        },
        select: { id: true },
      });
      await record(tx, "client_forfeited_bottles", f.client_forfeited_id, created.id);
      report.count("Forfeit (created)");
    }

    if (production === 0) {
      report.flag(
        `ZERO sales imported as PRODUCTION. Legacy encoded production as discount = 100 ` +
          `(architecture.md deviation #4) and the dump contains 66 such rows, so zero means the ` +
          `detection is wrong and those rows imported as full-revenue SALEs, inflating revenue and ` +
          `every variance that reads it.`,
      );
    }
    report.flag(
      `Sale kinds: ${plainSale} SALE, ${nonRevenue} NON_REVENUE, ${production} PRODUCTION. ` +
        `Check that split against expectation before trusting any period.`,
    );
  },
};

async function loadOrNull(tx: Parameters<Stage["run"]>[0], table: string, legacyId: string | number) {
  const row = await tx.legacyMap.findUnique({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
    select: { newId: true },
  });
  return row?.newId ?? null;
}
