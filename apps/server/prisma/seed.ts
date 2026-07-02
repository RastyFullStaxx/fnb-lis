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

async function main() {
  await seedUsers();
  await seedClients();
  await seedUnits();
  await seedCategories();
  await seedSettings();
  console.log(`Seed complete. Logins: admin / manager / staff / accountant / readonly — password ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
