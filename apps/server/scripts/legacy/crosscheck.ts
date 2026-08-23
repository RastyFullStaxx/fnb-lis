/**
 * Cross-check the migrated database against the legacy MySQL source.
 *
 *   npm run verify:legacy-data -w @fnb/server
 *
 * Needs the legacy dump loaded (see source.ts) and the import stages applied.
 * Re-run it after every re-import — the whole migration has to be re-verified
 * against the fresh production dump when that arrives.
 *
 * This is the row-parity and invariant half of Task 11's `verify:legacy`. The
 * other half — Full Audit parity against the real legacy XLSX reports in
 * docs/reference/ — needs the transaction stages, which are not built yet.
 */
import { prisma } from "../../src/db";
import { query, scalar } from "./source";
import { LOCATION_PLAN } from "./stages/tenancy";
import { mapUom } from "./units";

let fails = 0;
let warns = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? " - " + detail : ""}`);
  if (!pass) fails++;
};
const warn = (label: string, detail: string) => {
  console.log(`  warn  ${label} - ${detail}`);
  warns++;
};

async function main() {
  console.log("\n=== 1. Row-count parity against the legacy source ===");

  const legacyCats = Number(scalar("SELECT COUNT(*) FROM categories"));
  const mappedCats = await prisma.legacyMap.count({ where: { legacyTable: "categories" } });
  ok("every legacy category mapped", mappedCats === legacyCats, `${mappedCats}/${legacyCats}`);

  const legacyBottles = Number(scalar("SELECT COUNT(*) FROM bottles"));
  const mappedBottles = await prisma.legacyMap.count({ where: { legacyTable: "bottles" } });
  ok("every legacy bottle mapped to an Item", mappedBottles === legacyBottles, `${mappedBottles}/${legacyBottles}`);

  const mappedVariants = await prisma.legacyMap.count({ where: { legacyTable: "bottle_sizes" } });
  const legacySizes = Number(scalar("SELECT COUNT(*) FROM bottle_sizes"));
  console.log(`  info  variant mappings ${mappedVariants} (legacy bottle_sizes ${legacySizes}, plus client_bottles drift, minus exclusions)`);

  console.log("\n=== 2. Per-location catalog and menus vs legacy ===");
  for (const plan of LOCATION_PLAN) {
    const loc = await prisma.location.findFirst({
      where: { name: plan.location, client: { name: plan.client } },
      select: { id: true, _count: { select: { locationItems: true, menuItems: true } } },
    });
    if (!loc) {
      ok(`${plan.client} / ${plan.location} exists`, false);
      continue;
    }
    const branchList = plan.branches.join(",");
    // Normalise with mapUom + size 0->1, exactly as the importer does. Counting
    // RAW uom strings over-counts: at branch 90 "Beer" exists as both `mil` and
    // `ml`, which are one Unit, so a raw count says 382 where the truth is 381.
    const rawCombos = query<{ bottle_id: number; bottle_size: number; bottle_uom: string }>(
      `SELECT JSON_OBJECT('bottle_id', bottle_id, 'bottle_size', bottle_size, 'bottle_uom', bottle_uom)
       FROM client_bottles WHERE branch_id IN (${branchList})`,
    );
    const combos = new Set<string>();
    for (const c of rawCombos) {
      const u = mapUom(c.bottle_uom);
      if (!u) continue;
      const sz = Number(c.bottle_size) > 0 ? Number(c.bottle_size) : 1;
      combos.add(`${c.bottle_id}|${sz}|${u}`);
    }
    const distinct = combos.size;
    ok(
      `${plan.client} / ${plan.location} catalog`,
      loc._count.locationItems === distinct,
      `${loc._count.locationItems} rows vs ${distinct} normalised legacy combos`,
    );

    const menusDistinct = Number(
      scalar(`SELECT COUNT(DISTINCT LOWER(cocktail_name)) FROM client_menus WHERE branch_id IN (${branchList})`),
    );
    ok(
      `${plan.client} / ${plan.location} menus`,
      loc._count.menuItems === menusDistinct,
      `${loc._count.menuItems} vs ${menusDistinct} distinct legacy names`,
    );
  }

  console.log("\n=== 3. Referential integrity ===");
  const lines = await prisma.recipeLine.findMany({
    select: {
      id: true,
      locationItem: { select: { locationId: true } },
      recipeVersion: { select: { menuItem: { select: { locationId: true } } } },
    },
  });
  const cross = lines.filter((r) => r.locationItem.locationId !== r.recipeVersion.menuItem.locationId);
  ok("no recipe line points at another location's stock", cross.length === 0, `${cross.length} cross-location lines`);

  const versionless = await prisma.menuItem.count({ where: { versions: { none: {} } } });
  ok("every MenuItem has a RecipeVersion", versionless === 0, String(versionless));

  // Many-to-one IS the design: branches 73+74 merge into one Location, and the
  // Option-2 tenancy collapses several legacy "clients" into one real Client.
  // So assert the collisions are EXACTLY the intended set, not that there are none.
  const collisions = await prisma.$queryRawUnsafe<Array<{ legacyTable: string; newId: string }>>(
    "SELECT legacyTable, newId FROM LegacyMap GROUP BY legacyTable, newId HAVING COUNT(*) > 1",
  );
  // Every table where many-to-one is DELIBERATE:
  //   clients/branches  — the Mansion and Xylo tenancy merges
  //   client_menus(_v1) — the 178 deduplicated Mansion menus, each mapped onto
  //                       the menu that survived the name clash so their 204
  //                       branch-74 sales still resolve
  //   client_bottles    — superseded duplicate catalog rows (legacy soft-deleted
  //                       one and replaced it) mapped onto the row that won
  const expected = new Set(["clients", "branches", "client_menus", "client_menus_v1", "client_bottles"]);
  const unexpected = collisions.filter((c) => !expected.has(c.legacyTable));
  ok(
    "only the intended merges map many legacy rows onto one record",
    unexpected.length === 0,
    `${collisions.length} merge group(s), ${unexpected.length} unexpected`,
  );
  // Summarise rather than list: 356 menu merges would bury everything else.
  const byTable = new Map<string, number>();
  for (const c of collisions) byTable.set(c.legacyTable, (byTable.get(c.legacyTable) ?? 0) + 1);
  for (const [table, n] of [...byTable].sort()) console.log(`  info  merge groups in ${table}: ${n}`);

  console.log("\n=== 4. Invariants protecting the reconciliation ===");
  const zeroSize = await prisma.itemVariant.count({ where: { size: { lte: 0 } } });
  ok("no variant with size <= 0", zeroSize === 0, String(zeroSize));

  const trackedZero = await prisma.itemVariant.count({ where: { contentTracked: true, size: { lte: 0 } } });
  ok("no contentTracked variant with size <= 0 (openEquiv div-by-zero)", trackedZero === 0, String(trackedZero));

  const zeroDensity = await prisma.itemVariant.count({ where: { densityFactor: 0 } });
  ok("no variant densityFactor of exactly 0 (must be null)", zeroDensity === 0, String(zeroDensity));

  const zeroDensityCat = await prisma.category.count({ where: { defaultDensityFactor: 0 } });
  ok("no category defaultDensityFactor of exactly 0", zeroDensityCat === 0, String(zeroDensityCat));

  const zeroTare = await prisma.itemVariant.count({ where: { tareWeight: 0 } });
  ok("no variant tareWeight of exactly 0 (must be null)", zeroTare === 0, String(zeroTare));

  const noUnit = await prisma.itemVariant.count({ where: { tareWeight: { not: null }, tareWeightUnit: null } });
  ok("every tareWeight carries a tareWeightUnit", noUnit === 0, String(noUnit));

  const notGrams = await prisma.itemVariant.count({ where: { tareWeight: { not: null }, tareWeightUnit: { not: "g" } } });
  ok("catalog tare is on the gram scale", notGrams === 0, `${notGrams} not in grams`);

  const negCost = await prisma.locationItem.count({ where: { OR: [{ cost: { lt: 0 } }, { retail: { lt: 0 } }] } });
  ok("no negative cost or retail", negCost === 0, String(negCost));

  const negServing = await prisma.recipeLine.count({ where: { servingQty: { lte: 0 } } });
  ok("no recipe line with serving <= 0", negServing === 0, String(negServing));

  console.log("\n=== 5. Value spot-checks against legacy rows (Xylo / Bar) ===");
  const G = 28.349523125;
  const samples = query<{
    bottle_name: string;
    bottle_size: number;
    bottle_uom: string;
    tare_weight: number;
    default_cost: number;
    default_retail: number;
  }>(
    `SELECT JSON_OBJECT('bottle_name', b.bottle_name, 'bottle_size', cb.bottle_size,
       'bottle_uom', cb.bottle_uom, 'tare_weight', cb.tare_weight,
       'default_cost', cb.default_cost, 'default_retail', cb.default_retail)
     FROM client_bottles cb JOIN bottles b ON b.bottle_id = cb.bottle_id
     WHERE cb.branch_id = 93 AND cb.tare_weight > 0 AND cb.default_cost > 0
     ORDER BY cb.client_bottle_id LIMIT 6`,
  );
  for (const s of samples) {
    const size = Number(s.bottle_size) > 0 ? Number(s.bottle_size) : 1;
    const li = await prisma.locationItem.findFirst({
      where: {
        location: { name: "Bar", client: { name: "Xylo" } },
        itemVariant: { item: { name: s.bottle_name }, size },
      },
      select: { cost: true, retail: true, tareWeight: true },
    });
    if (!li) {
      ok(`spot ${s.bottle_name} ${size}${s.bottle_uom}`, false, "not found at Xylo / Bar");
      continue;
    }
    const expectTare = Math.round(Number(s.tare_weight) * G * 10) / 10;
    const good =
      Math.abs(li.cost - Number(s.default_cost)) < 0.001 &&
      Math.abs(li.retail - Number(s.default_retail)) < 0.001 &&
      Math.abs((li.tareWeight ?? 0) - expectTare) < 0.05;
    ok(
      `spot ${s.bottle_name} ${size}${s.bottle_uom}`,
      good,
      `cost ${li.cost}/${s.default_cost} retail ${li.retail}/${s.default_retail} tare ${li.tareWeight}g/${expectTare}g`,
    );
  }

  console.log("\n=== 6. True but worth seeing ===");
  const noCost = await prisma.locationItem.count({ where: { cost: 0 } });
  if (noCost) warn("LocationItems with cost 0", `${noCost} - valuation reads 0 for these`);
  const noRetail = await prisma.locationItem.count({ where: { retail: 0 } });
  if (noRetail) warn("LocationItems with retail 0", `${noRetail}`);
  const emptyRecipes = await prisma.recipeVersion.count({ where: { lines: { none: {} } } });
  if (emptyRecipes) warn("RecipeVersions with no lines", `${emptyRecipes} - menu sells but consumes nothing`);
  const disabledUsers = await prisma.user.count({ where: { username: { startsWith: "legacy_" }, status: "DISABLED" } });
  console.log(`  info  migrated users still DISABLED: ${disabledUsers}`);

  console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}  (${warns} warning(s))\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
