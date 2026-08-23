/**
 * Stage 5 — menus and recipes: MenuItem + RecipeVersion + RecipeLine.
 *
 * Each legacy menu becomes one MenuItem with a single version 1, snapshotted at
 * import. Legacy has no recipe versioning, so there is nothing else to carry.
 */
import type { Stage } from "../../import-legacy";
import { query } from "../source";
import { loadMap, record } from "../map";
import { migratedLocations } from "./tenancy";
import { mapUom, unmappableReason } from "../units";

type LegacyMenu = {
  menu_id: number;
  cocktail_name: string;
  branch_id: number;
  default_cost: string | number | null;
  default_retail: string | number | null;
  is_deleted: number;
};

type LegacyIngredient = {
  menu_ingridient_id: number;
  menu_id: number;
  branch_id: number;
  bottle_id: number;
  bottle_size: number;
  bottle_uom: string | null;
  serving: string | number;
};

const variantKey = (bottleId: number, size: number, uom: string) => `${bottleId}|${size}|${uom.toLowerCase()}`;

export const menusStage: Stage = {
  name: "menus",
  touched: migratedLocations,
  async run(tx, report, adminId) {
    const branchMap = await loadMap(tx, "branches");
    const variantMap = await loadMap(tx, "bottle_sizes");
    if (branchMap.size === 0 || variantMap.size === 0) {
      throw new Error(
        [
          "Missing prerequisites in LegacyMap. Run these first, with --confirm:",
          "  --stage=reference   --stage=tenancy   --stage=catalog   --stage=pricing",
        ].join("\n"),
      );
    }

    // ── Menus + version 1 ─────────────────────────────────────────────────
    const menus = query<LegacyMenu>(`
      SELECT JSON_OBJECT('menu_id', menu_id, 'cocktail_name', cocktail_name,
                         'branch_id', branch_id, 'default_cost', default_cost,
                         'default_retail', default_retail, 'is_deleted', is_deleted)
      FROM client_menus
      -- branch 73 before 74 so the Mansion merge keeps 73's recipe on a name clash.
      ORDER BY branch_id, menu_id
    `);

    /** legacy menu_id -> recipeVersionId, for the ingredient pass. */
    const versionByMenu = new Map<string, string>();
    /** legacy menu_id -> locationId. */
    const locationByMenu = new Map<string, string>();
    /** "locationId|lowercased name" -> the ids that won it. */
    const namesTaken = new Map<string, { menuItemId: string; versionId: string }>();

    for (const m of menus) {
      const locationId = branchMap.get(String(m.branch_id));
      if (!locationId) {
        report.skip("branch-not-migrated", `menu_id ${m.menu_id} on branch ${m.branch_id}`);
        continue;
      }
      const name = (m.cocktail_name ?? "").trim() || `(unnamed menu ${m.menu_id})`;
      const nameKey = `${locationId}|${name.toLowerCase()}`;

      // Mansion 73 and 74 land on one Location and share 178 of 202 menu names.
      // Keeping both would give the merged venue every cocktail twice. Branch 73
      // wins; the 24 names unique to 74 still come across, because deduplicating
      // by NAME rather than dropping branch 74 wholesale is what preserves them.
      const survivor = namesTaken.get(nameKey);
      if (survivor) {
        // Deduplicated, but STILL MAPPED to the menu that survived.
        //
        // Dropping the mapping is not free: 204 branch-74 sales reference these
        // menu_ids, and without a mapping the transactions stage cannot resolve
        // them and silently discards real revenue. The merged venue sells one
        // "Mojito"; a branch-74 sale of it is a sale of that same Mojito.
        await record(tx, "client_menus", m.menu_id, survivor.menuItemId);
        await record(tx, "client_menus_v1", m.menu_id, survivor.versionId);
        report.skip(
          "mansion-merge-duplicate-menu",
          `menu_id ${m.menu_id} "${name}" (branch ${m.branch_id}) — mapped onto the surviving menu so its sales still resolve`,
        );
        continue;
      }

      const existing = await loadOrNull(tx, "client_menus", m.menu_id);
      let menuItemId: string;
      if (existing) {
        menuItemId = existing;
        report.count("MenuItem (matched existing)");
      } else {
        const created = await tx.menuItem.create({
          data: { locationId, name, isActive: Number(m.is_deleted) !== 1 },
          select: { id: true },
        });
        menuItemId = created.id;
        await record(tx, "client_menus", m.menu_id, menuItemId);
        report.count("MenuItem (created)");
      }

      const existingVersion = await tx.recipeVersion.findUnique({
        where: { menuItemId_versionNo: { menuItemId, versionNo: 1 } },
        select: { id: true },
      });
      const versionId = existingVersion
        ? existingVersion.id
        : (
            await tx.recipeVersion.create({
              data: {
                menuItemId,
                versionNo: 1,
                srp: Number(m.default_retail ?? 0),
                costAtPublish: Number(m.default_cost ?? 0),
                publishedById: adminId,
                note: "Migrated from legacy client_menus",
              },
              select: { id: true },
            })
          ).id;
      if (!existingVersion) report.count("RecipeVersion (created)");
      await record(tx, "client_menus_v1", m.menu_id, versionId);

      namesTaken.set(nameKey, { menuItemId, versionId });
      versionByMenu.set(String(m.menu_id), versionId);
      locationByMenu.set(String(m.menu_id), locationId);
    }

    // ── Ingredients ───────────────────────────────────────────────────────
    const ingredients = query<LegacyIngredient>(`
      SELECT JSON_OBJECT(
        'menu_ingridient_id', i.menu_ingridient_id, 'menu_id', i.menu_id,
        'branch_id', m.branch_id, 'bottle_id', i.bottle_id,
        'bottle_size', i.bottle_size, 'bottle_uom', i.bottle_uom, 'serving', i.serving
      ) FROM client_menus_ingridients i
        JOIN client_menus m ON m.menu_id = i.menu_id
      ORDER BY i.menu_id, i.menu_ingridient_id
    `);

    /** Evidence for the open contentTracked question — see the flag below. */
    const fractionalOnUntracked: string[] = [];

    for (const g of ingredients) {
      const versionId = versionByMenu.get(String(g.menu_id));
      const locationId = locationByMenu.get(String(g.menu_id));
      if (!versionId || !locationId) {
        // Either the branch was not migrated, or the menu lost a name clash.
        report.skip("menu-not-imported", `menu_ingridient_id ${g.menu_ingridient_id} -> menu_id ${g.menu_id}`);
        continue;
      }

      let unitName: string | null;
      try {
        unitName = mapUom(g.bottle_uom);
      } catch (e) {
        throw new Error(`menu_ingridient_id ${g.menu_ingridient_id}: ${(e as Error).message}`);
      }
      if (unitName === null) {
        report.skip(
          "unmappable-uom",
          `menu_ingridient_id ${g.menu_ingridient_id} uom "${g.bottle_uom}" — ${unmappableReason(g.bottle_uom)}`,
        );
        continue;
      }

      const rawSize = Number(g.bottle_size ?? 0);
      const size = rawSize > 0 ? rawSize : 1;
      const variantId = variantMap.get(variantKey(g.bottle_id, size, unitName));
      if (!variantId) {
        report.skip(
          "ingredient-variant-missing",
          `menu_ingridient_id ${g.menu_ingridient_id}: bottle ${g.bottle_id} ${size}${unitName}`,
        );
        continue;
      }

      const locationItem = await tx.locationItem.findUnique({
        where: { locationId_itemVariantId: { locationId, itemVariantId: variantId } },
        select: { id: true, itemVariant: { select: { contentTracked: true, size: true, item: { select: { name: true } } } } },
      });
      if (!locationItem) {
        // A recipe missing an ingredient silently UNDERSTATES consumption in
        // every Full Audit that includes it — exactly the class of error this
        // system exists to catch. Never let this one pass quietly.
        report.skip(
          "ingredient-not-in-location-catalog",
          `menu_ingridient_id ${g.menu_ingridient_id}: bottle ${g.bottle_id} ${size}${unitName} not stocked at this location`,
        );
        continue;
      }

      const servingQty = Number(g.serving ?? 0);
      const v = locationItem.itemVariant;
      // size > 1 matters. When size is 1 — which is every variant normalised
      // from legacy size 0, i.e. most kitchen goods — `(serving / 1) x qty` and
      // `serving x qty` are the SAME number, so contentTracked cannot change
      // the answer. Flagging those would send someone chasing 766 non-issues.
      // The risk is real only for a multi-unit pack poured in fractions.
      if (!v.contentTracked && servingQty > 0 && v.size > 1 && servingQty < v.size) {
        fractionalOnUntracked.push(
          `${v.item.name} ${v.size}: serving ${servingQty} (menu_ingridient_id ${g.menu_ingridient_id})`,
        );
      }

      const existing = await loadOrNull(tx, "client_menus_ingridients", g.menu_ingridient_id);
      if (existing) {
        report.count("RecipeLine (matched existing)");
        continue;
      }
      const created = await tx.recipeLine.create({
        data: {
          recipeVersionId: versionId,
          locationItemId: locationItem.id,
          servingQty,
          sortOrder: g.menu_ingridient_id,
        },
        select: { id: true },
      });
      await record(tx, "client_menus_ingridients", g.menu_ingridient_id, created.id);
      report.count("RecipeLine (created)");
    }

    if (fractionalOnUntracked.length > 0) {
      report.flag(
        `${fractionalOnUntracked.length} recipe ingredient(s) pour a FRACTION of a variant that is ` +
          `not contentTracked. An untracked ingredient consumes \`serving x qty\` rather than ` +
          `\`(serving / size) x qty\`, so each of these overstates consumption by a factor of the ` +
          `pack size. This is the evidence for the open question recorded in the plan: whether ` +
          `contentTracked should be widened beyond "has a tare weight". Examples: ` +
          fractionalOnUntracked.slice(0, 5).join(" | "),
      );
    }
  },
};

async function loadOrNull(tx: Parameters<Stage["run"]>[0], table: string, legacyId: string | number) {
  const row = await tx.legacyMap.findUnique({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
    select: { newId: true },
  });
  return row?.newId ?? null;
}
