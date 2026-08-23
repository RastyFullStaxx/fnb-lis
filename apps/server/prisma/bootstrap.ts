/**
 * Reference data for a database that has never been seeded.
 *
 *   npm run db:bootstrap -w @fnb/server
 *
 * WHY THIS FILE EXISTS. Units, categories and settings used to live only in
 * seed.ts, inside the same main() as every demo fixture. security-runbook.md §1
 * correctly forbids `db:seed` in production — which meant a production database
 * built by following the deployment runbook had no units, no categories, no
 * settings and no users, and could not be logged into. The three functions below
 * are that reference data, moved out verbatim so seed.ts keeps producing byte-
 * identical golden fixtures while production can create the same rows without
 * the demo clients, demo pricing, and five accounts sharing one published
 * password.
 *
 * Everything here is idempotent (upsert-based) and safe to re-run.
 *
 * seed.ts imports from this file. Do not duplicate anything back into it.
 */
import { prisma } from "../src/db";
import { hashPassword } from "../src/auth/password";
import { randomBytes } from "node:crypto";

// ───────────────────────── Weight scale ─────────────────────────
//
// Moved here from seed.ts so the seeder and scripts/import-legacy.ts share ONE
// definition of the ounce. The legacy system records bottle weights on the OUNCE
// scale (tare ~13-36 oz for a 750ml bottle) and its density factors are ml per
// ounce (Vodka 30.12). This database stores GRAMS and ml-per-gram. Two
// definitions of this constant would drift, and the failure would be silent:
// content computed off a mismatched scale still looks like a plausible number.

export const G_PER_OZ = 28.349523125;
export const gramsFromOz = (oz: number) => Math.round(oz * G_PER_OZ * 10) / 10;
export const densityPerGram = (perOz: number) => Math.round((perOz / G_PER_OZ) * 10000) / 10000;

// ───────────────────────── Units ─────────────────────────

export async function seedUnits() {
  // Base units: VOLUME → ml, MASS → g, COUNT → 1
  const units: Array<{ name: string; kind: string; factorToBase: number }> = [
    { name: "ml", kind: "VOLUME", factorToBase: 1 },
    { name: "L", kind: "VOLUME", factorToBase: 1000 },
    { name: "fl oz", kind: "VOLUME", factorToBase: 29.5735 },
    { name: "gal", kind: "VOLUME", factorToBase: 3785.41 },
    { name: "g", kind: "MASS", factorToBase: 1 },
    { name: "kg", kind: "MASS", factorToBase: 1000 },
    { name: "oz", kind: "MASS", factorToBase: 28.3495 },
    { name: "lb", kind: "MASS", factorToBase: 453.592 },
    { name: "pc", kind: "COUNT", factorToBase: 1 },
    { name: "bottle", kind: "COUNT", factorToBase: 1 },
    { name: "pack", kind: "COUNT", factorToBase: 1 },
    { name: "case", kind: "COUNT", factorToBase: 1 },
    { name: "box", kind: "COUNT", factorToBase: 1 },
    { name: "tray", kind: "COUNT", factorToBase: 1 },
    { name: "can", kind: "COUNT", factorToBase: 1 },
    { name: "dozen", kind: "COUNT", factorToBase: 12 },
    // Asset register UOM vocabulary (asset-seed-data.ts) — distinct from the
    // Beverage/Food/Supplies count units above; the client's sheet uses these
    // exact words rather than "pc"/"box".
    { name: "Unit", kind: "COUNT", factorToBase: 1 },
    { name: "Piece", kind: "COUNT", factorToBase: 1 },
    { name: "Kit", kind: "COUNT", factorToBase: 1 },
    { name: "Set", kind: "COUNT", factorToBase: 1 },
    // Legacy `bottle_uom` values with no existing equivalent (5 and 1 rows in
    // fnb.sql respectively). Declared here rather than invented mid-import —
    // scripts/legacy/units.ts aborts on an unrecognised UOM precisely so that a
    // typo can never silently become a Unit with no conversion factor.
    { name: "portion", kind: "COUNT", factorToBase: 1 },
    { name: "order", kind: "COUNT", factorToBase: 1 },
  ];
  for (const u of units) {
    await prisma.unit.upsert({
      where: { name: u.name },
      update: { kind: u.kind, factorToBase: u.factorToBase },
      create: { ...u, isSystem: true },
    });
  }
}

// ───────────────────────── Categories ─────────────────────────

export async function seedCategories() {
  const categories: Array<{
    name: string;
    productType: string;
    defaultDensityFactor?: number;
    sortOrder: number;
    // Perishability policy layer (expiry-date-plan.md / expiry-date-phases.md
    // Phase 1.5). Omitted = schema default (true, perishable) — most of the
    // catalog spoils. Explicit `false` marks the seeded exception: true
    // spirits (self-preserving, high proof — no bar tracks a "best by" date
    // on Jack Daniel's) and every Supplies / Asset category (neither spoils).
    defaultPerishable?: boolean;
  }> = [
    { name: "Vodka", productType: "Beverage", defaultDensityFactor: 30.12, sortOrder: 1, defaultPerishable: false },
    { name: "Rum", productType: "Beverage", defaultDensityFactor: 30.49, sortOrder: 2, defaultPerishable: false },
    { name: "Whisky", productType: "Beverage", defaultDensityFactor: 30.86, sortOrder: 3, defaultPerishable: false },
    { name: "Gin", productType: "Beverage", defaultDensityFactor: 30.49, sortOrder: 4, defaultPerishable: false },
    { name: "Brandy", productType: "Beverage", defaultDensityFactor: 30.3, sortOrder: 5, defaultPerishable: false },
    { name: "Tequila", productType: "Beverage", defaultDensityFactor: 30.67, sortOrder: 6, defaultPerishable: false },
    { name: "Single Malt Whisky", productType: "Beverage", defaultDensityFactor: 30.12, sortOrder: 7, defaultPerishable: false },
    { name: "Cognac", productType: "Beverage", defaultDensityFactor: 30.67, sortOrder: 8, defaultPerishable: false },
    { name: "Bourbon", productType: "Beverage", defaultDensityFactor: 30.86, sortOrder: 9, defaultPerishable: false },
    // Aperitif and Liqueur are dairy- or wine-based (Baileys, vermouth), not
    // distilled — they spoil and stay on the schema default (true) despite
    // sharing productType "Beverage" with the true spirits above.
    { name: "Aperitif", productType: "Beverage", defaultDensityFactor: 28.9, sortOrder: 10 },
    { name: "Liqueur", productType: "Beverage", sortOrder: 11 },
    { name: "Wine", productType: "Beverage", sortOrder: 12 },
    { name: "Beer", productType: "Beverage", sortOrder: 13 },
    { name: "Soda & Mixers", productType: "Beverage", sortOrder: 14 },
    { name: "Juices", productType: "Beverage", sortOrder: 15 },
    { name: "Syrup", productType: "Beverage", sortOrder: 16 },
    { name: "Meat", productType: "Food", sortOrder: 20 },
    { name: "Poultry", productType: "Food", sortOrder: 21 },
    { name: "Seafood", productType: "Food", sortOrder: 22 },
    { name: "Dairy", productType: "Food", sortOrder: 23 },
    { name: "Produce", productType: "Food", sortOrder: 24 },
    // Dry Goods (e.g. Cooking Oil) spoils on a long timeline, unlike Meat or
    // Dairy in the same productType "Food" — but it still spoils, so it stays
    // on the schema default (true). A location that wants a shorter effective
    // window overrides at LocationItem, not here.
    { name: "Dry Goods", productType: "Food", sortOrder: 25 },
    { name: "Frozen", productType: "Food", sortOrder: 26 },
    { name: "Sauces & Dressings", productType: "Food", sortOrder: 27 },
    { name: "Consumables", productType: "Supplies", sortOrder: 30, defaultPerishable: false },
    // Asset now has its own real product type (Fix Plan Phase E) — equipment,
    // tools, and other non-consumable items, distinct from the consumable
    // Supplies above (Table Napkins, Disposable Gloves). Neither Supplies nor
    // Asset spoils, so every category below is seeded defaultPerishable: false.
    { name: "Equipment", productType: "Asset", sortOrder: 40, defaultPerishable: false },
    // Full AST-001->070 register categories (Phase 7.3) — one category per
    // item, per the client's own sheet and the proposal's explicit
    // recommendation not to invent a consolidated scheme. Kept distinct from
    // the flat "Equipment" category above, which predates this and already
    // holds its own two demo items (Bar Blender, Commercial Ice Machine).
    { name: "POS Equipment", productType: "Asset", sortOrder: 41, defaultPerishable: false },
    { name: "IT Equipment", productType: "Asset", sortOrder: 42, defaultPerishable: false },
    { name: "Security CCTV", productType: "Asset", sortOrder: 43, defaultPerishable: false },
    { name: "Security DVR/NVR", productType: "Asset", sortOrder: 44, defaultPerishable: false },
    { name: "Audio System", productType: "Asset", sortOrder: 45, defaultPerishable: false },
    { name: "Entertainment", productType: "Asset", sortOrder: 46, defaultPerishable: false },
    { name: "Coffee Equipment", productType: "Asset", sortOrder: 47, defaultPerishable: false },
    { name: "Beverage Equipment", productType: "Asset", sortOrder: 48, defaultPerishable: false },
    { name: "Refrigeration Upright", productType: "Asset", sortOrder: 49, defaultPerishable: false },
    { name: "Refrigeration Chest", productType: "Asset", sortOrder: 50, defaultPerishable: false },
    { name: "Refrigeration Wine", productType: "Asset", sortOrder: 51, defaultPerishable: false },
    { name: "Refrigeration", productType: "Asset", sortOrder: 52, defaultPerishable: false },
    { name: "Kitchen Equipment", productType: "Asset", sortOrder: 53, defaultPerishable: false },
    { name: "Furniture", productType: "Asset", sortOrder: 54, defaultPerishable: false },
    { name: "Bar Tools", productType: "Asset", sortOrder: 55, defaultPerishable: false },
    { name: "Glassware", productType: "Asset", sortOrder: 56, defaultPerishable: false },
    { name: "Dinning Ware", productType: "Asset", sortOrder: 57, defaultPerishable: false },
    { name: "Safety Fire", productType: "Asset", sortOrder: 58, defaultPerishable: false },
    { name: "Safety — First Aid", productType: "Asset", sortOrder: 59, defaultPerishable: false },
    { name: "Cleaning Equipment", productType: "Asset", sortOrder: 60, defaultPerishable: false },
    { name: "Office Equipment", productType: "Asset", sortOrder: 61, defaultPerishable: false },
  ];
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {
        productType: cat.productType,
        defaultDensityFactor: cat.defaultDensityFactor != null ? densityPerGram(cat.defaultDensityFactor) : null,
        sortOrder: cat.sortOrder,
        defaultPerishable: cat.defaultPerishable ?? true,
      },
      create: {
        ...cat,
        defaultDensityFactor: cat.defaultDensityFactor != null ? densityPerGram(cat.defaultDensityFactor) : null,
        defaultPerishable: cat.defaultPerishable ?? true,
      },
    });
  }
}

// ───────────────────────── Settings ─────────────────────────

export async function seedSettings() {
  const settings: Array<{ key: string; value: unknown }> = [
    // Garnish added 2026-08-04 (client: "parehas" — bar and kitchen both).
    { key: "productTypes", value: ["Beverage", "Food", "Garnish", "Supplies", "Asset"] },
    // Asset condition/status presets (asset-module-proposal.md, client-confirmed
    // 2026-07-23). Same data-driven-list shape as productTypes above; the UI adds
    // an "Other" branch on top rather than storing it as a literal option.
    { key: "conditionOptions", value: ["Active", "Needs Repair", "Under Repair", "Retired", "Damaged"] },
    { key: "statusOptions", value: ["In Use", "In Storage", "For Disposal", "Sold"] },
    { key: "company", value: { name: "Liquor Inventory Solution", shortName: "LIS" } },
  ];
  for (const s of settings) {
    await prisma.setting.upsert({
      where: { clientId_key: { clientId: "", key: s.key } },
      update: { value: JSON.stringify(s.value) },
      create: { clientId: "", key: s.key, value: JSON.stringify(s.value) },
    });
  }
}

// ───────────────────────── First administrator ─────────────────────────

/**
 * One ADMIN so a fresh production database can be logged into.
 *
 * The password is random and printed once. There is no `mustChangePassword`
 * column and this deliberately does not add one — the admin changes it in the
 * app. What matters is that no fixed, published default password ever reaches
 * production; seed.ts's five accounts sharing `Fnb!2026` stay in seed.ts.
 *
 * security-runbook.md §1 requires a SECOND named ADMIN before real data lands:
 * an administrator cannot reset their own second factor, so a lone ADMIN who
 * loses their phone and recovery codes has no path back through the app.
 */
export async function seedAdmin() {
  const username = process.env.FNB_ADMIN_USER;
  if (!username) throw new Error("FNB_ADMIN_USER is required — name the first administrator.");

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`[bootstrap] admin "${username}" already exists — left untouched.`);
    return;
  }

  const password = randomBytes(18).toString("base64url");
  await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      firstName: process.env.FNB_ADMIN_FIRST ?? "System",
      lastName: process.env.FNB_ADMIN_LAST ?? "Administrator",
      email: process.env.FNB_ADMIN_EMAIL ?? null,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const rule = "─".repeat(64);
  console.log(rule);
  console.log(`  ADMIN CREATED   ${username}`);
  console.log(`  PASSWORD        ${password}`);
  console.log("  Shown once and not recoverable. Store it, then change it in the app.");
  console.log("  Create a SECOND admin before go-live (security-runbook.md §1).");
  console.log(rule);
}

export async function bootstrapAll() {
  await seedUnits();
  await seedCategories();
  await seedSettings();
  await seedAdmin();
}

// Runnable directly; inert when seed.ts imports from it.
const invoked = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (invoked.endsWith("prisma/bootstrap.ts")) {
  bootstrapAll()
    .then(() => console.log("Bootstrap complete."))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
