import { prisma } from "./src/db";

async function main() {
  const ids = ["cmr6eog91002g0o2f4ak4xooh", "cmrdcpx3t002oa82ftjd5afs6"];
  for (const id of ids) {
    const s = await prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: { select: { id: true, refNo: true, purchaseDate: true, status: true, locationId: true } },
      },
    });
    console.log("----", id, JSON.stringify({ ...s, purchases: undefined }, null, 1));
    console.log("purchases:", JSON.stringify(s?.purchases));
  }
  const drafts = await prisma.purchase.findMany({
    where: { refNo: "DRAFT-BAR-001" },
    select: { id: true, refNo: true, supplierId: true },
  });
  console.log("drafts:", JSON.stringify(drafts));
  const logs = await prisma.activityLog.findMany({
    where: { entity: "Supplier" },
    select: { action: true, summary: true, createdAt: true, entityId: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("supplier activity:", JSON.stringify(logs, null, 1));
}

main().finally(() => prisma.$disconnect());
