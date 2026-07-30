import { prisma } from "../db";

/**
 * Suspected double-entry: the same real-world event recorded twice, once in the
 * browser and once on the offline desktop.
 *
 * This is the one risk two-way operation creates that **sync cannot resolve**
 * (docs/sync-and-data-lifecycle.md §7.4). Staff records a delivery on the bar
 * PC; the manager records the same delivery on a laptop. Two rows, different
 * ids, both valid — and genuinely indistinguishable from a real repeat entry.
 * No merge algorithm can tell them apart, so this never auto-deletes anything.
 * It surfaces candidates and a human decides.
 *
 * The single-writer rule used to prevent this structurally. Removing it is what
 * made this file necessary.
 */

export interface DuplicateGroup {
  kind: "SALE" | "PURCHASE";
  businessDate: string;
  itemName: string;
  qty: number;
  records: Array<{
    id: string;
    createdAt: Date;
    createdByName: string;
    /** Null = the web app; otherwise the machine's name. */
    source: string | null;
  }>;
}

/**
 * Matching rule: same item, same business date, same quantity, recorded from
 * DIFFERENT sources.
 *
 * "Different sources" is doing the real work. Two identical sales entered
 * minutes apart in the same browser are overwhelmingly likely to be two genuine
 * rounds of drinks; the same pair split across a bar PC and a laptop is the
 * shape of a double entry. Requiring the split keeps this list short enough to
 * actually be read — a report nobody opens catches nothing.
 */
export async function suspectedDuplicates(locationId: string, from?: string): Promise<DuplicateGroup[]> {
  const deviceNames = new Map(
    (await prisma.device.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]),
  );
  const label = (originDeviceId: string | null) =>
    originDeviceId ? (deviceNames.get(originDeviceId) ?? "Unknown computer") : null;

  const groups: DuplicateGroup[] = [];

  const sales = await prisma.saleRecord.findMany({
    where: { locationId, status: { not: "VOID" }, saleDate: from ? { gte: from } : undefined },
    select: {
      id: true,
      saleDate: true,
      qty: true,
      createdAt: true,
      createdByName: true,
      originDeviceId: true,
      locationItem: { select: { itemVariant: { select: { item: { select: { name: true } } } } } },
      menuItem: { select: { name: true } },
    },
  });
  const salesByKey = new Map<string, typeof sales>();
  for (const s of sales) {
    const name = s.locationItem?.itemVariant.item.name ?? s.menuItem?.name ?? "item";
    const key = `${s.saleDate}|${name}|${s.qty}`;
    const list = salesByKey.get(key);
    if (list) list.push(s);
    else salesByKey.set(key, [s]);
  }
  for (const [key, list] of salesByKey) {
    if (list.length < 2) continue;
    if (new Set(list.map((s) => s.originDeviceId)).size < 2) continue; // same source — not our case
    const [businessDate, itemName] = key.split("|");
    groups.push({
      kind: "SALE",
      businessDate: businessDate!,
      itemName: itemName!,
      qty: list[0]!.qty,
      records: list.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        createdByName: s.createdByName,
        source: label(s.originDeviceId),
      })),
    });
  }

  // Deliveries: grouped by the LINE, because "the same delivery entered twice"
  // shows up as the same item and quantity on the same date, not as two
  // identical purchase headers (ref numbers and notes usually differ).
  const lines = await prisma.purchaseLine.findMany({
    where: {
      status: "ACTIVE",
      purchase: {
        locationId,
        status: { not: "VOID" },
        purchaseDate: from ? { gte: from } : undefined,
      },
    },
    select: {
      id: true,
      qty: true,
      createdAt: true,
      createdByName: true,
      purchase: { select: { purchaseDate: true, originDeviceId: true } },
      locationItem: { select: { itemVariant: { select: { item: { select: { name: true } } } } } },
    },
  });
  const linesByKey = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = `${l.purchase.purchaseDate}|${l.locationItem.itemVariant.item.name}|${l.qty}`;
    const list = linesByKey.get(key);
    if (list) list.push(l);
    else linesByKey.set(key, [l]);
  }
  for (const [key, list] of linesByKey) {
    if (list.length < 2) continue;
    if (new Set(list.map((l) => l.purchase.originDeviceId)).size < 2) continue;
    const [businessDate, itemName] = key.split("|");
    groups.push({
      kind: "PURCHASE",
      businessDate: businessDate!,
      itemName: itemName!,
      qty: list[0]!.qty,
      records: list.map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        createdByName: l.createdByName,
        source: label(l.purchase.originDeviceId),
      })),
    });
  }

  return groups.sort((a, b) => b.businessDate.localeCompare(a.businessDate));
}
