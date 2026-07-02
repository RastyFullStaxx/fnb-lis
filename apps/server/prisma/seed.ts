import { prisma } from "../src/db";
import { hashPassword } from "../src/auth/password";

const PASSWORD = "Fnb!2026"; // documented demo password for all seeded roles

async function seedUsers() {
  const passwordHash = await hashPassword(PASSWORD);
  const users = [
    { username: "admin", firstName: "Lourd", lastName: "Borromeo", role: "ADMIN" },
    { username: "manager", firstName: "Maria", lastName: "Santos", role: "MANAGER" },
    { username: "staff", firstName: "Paolo", lastName: "Reyes", role: "STAFF" },
    { username: "accountant", firstName: "Grace", lastName: "Lim", role: "ACCOUNTANT" },
    { username: "readonly", firstName: "Vis", lastName: "Itor", role: "READONLY" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { role: u.role, status: "ACTIVE" },
      create: { ...u, passwordHash, email: `${u.username}@fnb-lis.local` },
    });
  }
}

async function seedClients() {
  const prime = await upsertClientByName("Prime Hospitality Group");
  await upsertLocation(prime.id, "Main Bar");
  await upsertLocation(prime.id, "Kitchen");

  const casa = await upsertClientByName("Casa Verde Restaurant");
  await upsertLocation(casa.id, "Main");

  // Non-admin users are scoped via UserClientAccess (ADMIN bypasses).
  const assign: Record<string, string[]> = {
    manager: [prime.id, casa.id],
    staff: [prime.id],
    accountant: [prime.id],
    readonly: [prime.id],
  };
  for (const [username, clientIds] of Object.entries(assign)) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) continue;
    for (const clientId of clientIds) {
      await prisma.userClientAccess.upsert({
        where: { userId_clientId: { userId: user.id, clientId } },
        update: {},
        create: { userId: user.id, clientId },
      });
    }
  }
}

async function upsertClientByName(name: string) {
  const existing = await prisma.client.findFirst({ where: { name } });
  return existing ?? prisma.client.create({ data: { name } });
}

async function upsertLocation(clientId: string, name: string) {
  const existing = await prisma.location.findFirst({ where: { clientId, name } });
  return existing ?? prisma.location.create({ data: { clientId, name } });
}

async function seedUnits() {
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
  ];
  for (const u of units) {
    await prisma.unit.upsert({
      where: { name: u.name },
      update: { kind: u.kind, factorToBase: u.factorToBase },
      create: { ...u, isSystem: true },
    });
  }
}

async function seedCategories() {
  // Density factors (ml per weight-unit on the oz scale) verified from legacy fnb.sql.
  const categories: Array<{ name: string; productType: string; defaultDensityFactor?: number; sortOrder: number }> = [
    { name: "Vodka", productType: "Beverage", defaultDensityFactor: 30.12, sortOrder: 1 },
    { name: "Rum", productType: "Beverage", defaultDensityFactor: 30.49, sortOrder: 2 },
    { name: "Whisky", productType: "Beverage", defaultDensityFactor: 30.86, sortOrder: 3 },
    { name: "Gin", productType: "Beverage", defaultDensityFactor: 30.49, sortOrder: 4 },
    { name: "Brandy", productType: "Beverage", defaultDensityFactor: 30.3, sortOrder: 5 },
    { name: "Tequila", productType: "Beverage", defaultDensityFactor: 30.67, sortOrder: 6 },
    { name: "Single Malt Whisky", productType: "Beverage", defaultDensityFactor: 30.12, sortOrder: 7 },
    { name: "Cognac", productType: "Beverage", defaultDensityFactor: 30.67, sortOrder: 8 },
    { name: "Bourbon", productType: "Beverage", defaultDensityFactor: 30.86, sortOrder: 9 },
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
    { name: "Dry Goods", productType: "Food", sortOrder: 25 },
    { name: "Frozen", productType: "Food", sortOrder: 26 },
    { name: "Sauces & Dressings", productType: "Food", sortOrder: 27 },
    { name: "Consumables", productType: "Supplies", sortOrder: 30 },
  ];
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {
        productType: cat.productType,
        defaultDensityFactor: cat.defaultDensityFactor ?? null,
        sortOrder: cat.sortOrder,
      },
      create: { ...cat, defaultDensityFactor: cat.defaultDensityFactor ?? null },
    });
  }
}

async function seedSettings() {
  const settings: Array<{ key: string; value: unknown }> = [
    { key: "productTypes", value: ["Beverage", "Food", "Supplies"] },
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

// ── Seed v2: demo items + location catalogs ──
// Tare weights are in oz to match the legacy oz-scale density factors (ml per oz).

interface SeedVariant {
  size: number;
  unit: string;
  contentTracked?: boolean;
  tareWeight?: number;
  densityFactor?: number;
}

const ITEMS: Array<{ name: string; category: string; variants: SeedVariant[] }> = [
  {
    name: "Absolut Vodka",
    category: "Vodka",
    variants: [
      { size: 700, unit: "ml", contentTracked: true, tareWeight: 16.9 },
      { size: 1000, unit: "ml", contentTracked: true, tareWeight: 19.4 },
    ],
  },
  { name: "Jack Daniel's Old No. 7", category: "Whisky", variants: [{ size: 700, unit: "ml", contentTracked: true, tareWeight: 17.2 }] },
  { name: "Bacardi Superior", category: "Rum", variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 16.5 }] },
  { name: "Bombay Sapphire", category: "Gin", variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 21.2 }] },
  { name: "Jose Cuervo Especial", category: "Tequila", variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 17.6 }] },
  { name: "San Miguel Pale Pilsen", category: "Beer", variants: [{ size: 330, unit: "ml" }] },
  { name: "Tonic Water", category: "Soda & Mixers", variants: [{ size: 200, unit: "ml" }] },
  {
    name: "Grenadine Syrup",
    category: "Syrup",
    // Item-level density override (no category default for Syrup).
    variants: [{ size: 750, unit: "ml", contentTracked: true, tareWeight: 15.0, densityFactor: 25.0 }],
  },
  { name: "Chicken Breast", category: "Poultry", variants: [{ size: 1, unit: "kg" }] },
  { name: "Cooking Oil", category: "Dry Goods", variants: [{ size: 1, unit: "L" }] },
  // Universality proof: a Supplies item counted in packs.
  { name: "Table Napkins", category: "Consumables", variants: [{ size: 1, unit: "pack" }] },
];

// [item name, size, unit, cost, retail] per location.
const MAIN_BAR_PRICES: Array<[string, number, string, number, number]> = [
  ["Absolut Vodka", 700, "ml", 620, 1650],
  ["Absolut Vodka", 1000, "ml", 850, 2200],
  ["Jack Daniel's Old No. 7", 700, "ml", 950, 2400],
  ["Bacardi Superior", 750, "ml", 550, 1400],
  ["Bombay Sapphire", 750, "ml", 1100, 2600],
  ["Jose Cuervo Especial", 750, "ml", 890, 2200],
  ["San Miguel Pale Pilsen", 330, "ml", 45, 120],
  ["Tonic Water", 200, "ml", 30, 90],
  ["Grenadine Syrup", 750, "ml", 180, 0], // deliberately unpriced retail → exercises the red badge
  ["Table Napkins", 1, "pack", 85, 0],
];

const KITCHEN_PRICES: Array<[string, number, string, number, number]> = [
  ["Chicken Breast", 1, "kg", 180, 320],
  ["Cooking Oil", 1, "L", 95, 160],
];

async function seedItems() {
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  for (const def of ITEMS) {
    const category = await prisma.category.findUnique({ where: { name: def.category } });
    if (!category) continue;
    let item = await prisma.item.findFirst({ where: { name: def.name } });
    if (!item) {
      item = await prisma.item.create({
        data: { name: def.name, categoryId: category.id, createdById: admin?.id },
      });
    }
    for (const v of def.variants) {
      const unit = await prisma.unit.findUnique({ where: { name: v.unit } });
      if (!unit) continue;
      await prisma.itemVariant.upsert({
        where: { itemId_size_unitId: { itemId: item.id, size: v.size, unitId: unit.id } },
        update: {},
        create: {
          itemId: item.id,
          size: v.size,
          unitId: unit.id,
          contentTracked: v.contentTracked ?? false,
          tareWeight: v.tareWeight ?? null,
          tareWeightUnit: v.tareWeight ? "oz" : null,
          densityFactor: v.densityFactor ?? null,
        },
      });
    }
  }
}

async function seedLocationCatalog(clientName: string, locationName: string, prices: Array<[string, number, string, number, number]>) {
  const location = await prisma.location.findFirst({
    where: { name: locationName, client: { name: clientName } },
  });
  if (!location) return;
  for (const [itemName, size, unitName, cost, retail] of prices) {
    const variant = await prisma.itemVariant.findFirst({
      where: { size, item: { name: itemName }, unit: { name: unitName } },
    });
    if (!variant) continue;
    await prisma.locationItem.upsert({
      where: { locationId_itemVariantId: { locationId: location.id, itemVariantId: variant.id } },
      update: {},
      create: { locationId: location.id, itemVariantId: variant.id, cost, retail },
    });
  }
}

async function seedSuppliers() {
  const prime = await prisma.client.findFirst({ where: { name: "Prime Hospitality Group" } });
  if (!prime) return;
  for (const name of ["Metro Beverage Distribution", "FreshFoods Corp"]) {
    const exists = await prisma.supplier.findFirst({ where: { clientId: prime.id, name } });
    if (!exists) await prisma.supplier.create({ data: { clientId: prime.id, name } });
  }
}

async function main() {
  await seedUsers();
  await seedClients();
  await seedUnits();
  await seedCategories();
  await seedSettings();
  await seedItems();
  await seedLocationCatalog("Prime Hospitality Group", "Main Bar", MAIN_BAR_PRICES);
  await seedLocationCatalog("Prime Hospitality Group", "Kitchen", KITCHEN_PRICES);
  await seedSuppliers();
  console.log(`Seed complete. Logins: admin / manager / staff / accountant / readonly — password ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
