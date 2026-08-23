/**
 * Remove the seeded demo data, leaving the migrated legacy data behind.
 *
 *   npx tsx apps/server/scripts/remove-demo-data.ts            # dry run
 *   npx tsx apps/server/scripts/remove-demo-data.ts --confirm   # delete
 *
 * TAKE A BACKUP FIRST: npm run backup -w @fnb/server
 *
 * WHAT IT DOES NOT TOUCH, deliberately:
 *
 *  - ActivityLog. It is hash-chained (services/activity-chain.ts); deleting rows
 *    breaks the chain and the verifier reports it as tampering. Demo entries
 *    carry a clientId that no longer resolves, which is harmless — the columns
 *    are plain nullable strings with no foreign key. An append-only ledger that
 *    can be tidied is not append-only.
 *
 *  - Units, categories, settings. Reference data that production needs; that is
 *    the whole point of prisma/bootstrap.ts.
 *
 *  - Any migrated client. Sample Kitchen included — it came from the legacy dump,
 *    not from the seeder.
 */
import { prisma } from "../src/db";
import type { Prisma } from "../src/generated/prisma/client";

/** Everything the legacy migration created. Anything else is demo. */
const MIGRATED_CLIENTS = ["Mansion Sports Bar & Lounge", "Xylo", "Sample Kitchen", "Pablo/Cartel"];

/**
 * The six accounts prisma/seed.ts creates, named explicitly.
 *
 * NOT "anything without a legacy_ prefix" — that would sweep up the real
 * administrator db:bootstrap just created, which is the one account standing
 * between this script and an unloggable-into database.
 */
const DEMO_USERNAMES = ["admin", "owner", "manager", "staff", "accountant", "readonly"];

type Tx = Prisma.TransactionClient;

const tally: Array<[string, number]> = [];
const note = (label: string, n: number) => {
  if (n > 0) tally.push([label, n]);
};

async function removeDemoClients(tx: Tx, clientIds: string[], locationIds: string[]) {
  const L = { locationId: { in: locationIds } };

  // Order matters. Sale records reference recipe versions, menu items and
  // location items, so they go before any of those.
  //
  // The correction chains (correctionOfId) are self-referencing FKs: a bulk
  // delete can try to remove a parent before its child, so they are unlinked
  // first. Nulling a column on rows about to be deleted is not a mutation of
  // live data.
  await tx.saleRecord.updateMany({ where: L, data: { correctionOfId: null } });
  note("SaleRecord", (await tx.saleRecord.deleteMany({ where: L })).count);

  note("BottleKeep", (await tx.bottleKeep.deleteMany({ where: L })).count);
  note("Forfeit", (await tx.forfeit.deleteMany({ where: L })).count);

  const sessions = await tx.countSession.findMany({ where: L, select: { id: true } });
  const sessionIds = sessions.map((s) => s.id);
  await tx.countLine.updateMany({ where: { countSessionId: { in: sessionIds } }, data: { correctionOfId: null } });
  note("CountLine", (await tx.countLine.deleteMany({ where: { countSessionId: { in: sessionIds } } })).count);
  note("CountSession", (await tx.countSession.deleteMany({ where: L })).count);

  const purchases = await tx.purchase.findMany({ where: L, select: { id: true } });
  const purchaseIds = purchases.map((p) => p.id);
  await tx.purchaseLine.updateMany({ where: { purchaseId: { in: purchaseIds } }, data: { correctionOfId: null } });
  note("PurchaseLine", (await tx.purchaseLine.deleteMany({ where: { purchaseId: { in: purchaseIds } } })).count);
  note("Purchase", (await tx.purchase.deleteMany({ where: L })).count);

  const transfers = await tx.transfer.findMany({
    where: { OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }] },
    select: { id: true },
  });
  const transferIds = transfers.map((t) => t.id);
  note(
    "TransferReceiptLine",
    (await tx.transferReceiptLine.deleteMany({ where: { transferLine: { transferId: { in: transferIds } } } })).count,
  );
  note("TransferLine", (await tx.transferLine.deleteMany({ where: { transferId: { in: transferIds } } })).count);
  note("Transfer", (await tx.transfer.deleteMany({ where: { id: { in: transferIds } } })).count);

  const menus = await tx.menuItem.findMany({ where: L, select: { id: true } });
  const menuIds = menus.map((m) => m.id);
  const versions = await tx.recipeVersion.findMany({ where: { menuItemId: { in: menuIds } }, select: { id: true } });
  const versionIds = versions.map((v) => v.id);
  note("RecipeLine", (await tx.recipeLine.deleteMany({ where: { recipeVersionId: { in: versionIds } } })).count);
  note("RecipeVersion", (await tx.recipeVersion.deleteMany({ where: { id: { in: versionIds } } })).count);
  note("MenuItem", (await tx.menuItem.deleteMany({ where: L })).count);

  const batches = await tx.importBatch.findMany({ where: L, select: { id: true } });
  const batchIds = batches.map((b) => b.id);
  note("ImportRow", (await tx.importRow.deleteMany({ where: { batchId: { in: batchIds } } })).count);
  note("ImportBatch", (await tx.importBatch.deleteMany({ where: L })).count);

  note("ItemAlias", (await tx.itemAlias.deleteMany({ where: { clientId: { in: clientIds } } })).count);
  note("LocationItem", (await tx.locationItem.deleteMany({ where: L })).count);
  note("LocationArea", (await tx.locationArea.deleteMany({ where: L })).count);
  note("LocationModule", (await tx.locationModule.deleteMany({ where: L })).count);

  // DevicePin is keyed by userId alone (no device relation), so it is purely
  // user-scoped and handled in removeDemoUsers.
  note("Device", (await tx.device.deleteMany({ where: { clientId: { in: clientIds } } })).count);

  note("Location", (await tx.location.deleteMany({ where: { id: { in: locationIds } } })).count);

  const subs = await tx.subscription.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  note("SubscriptionReport", (await tx.subscriptionReport.deleteMany({ where: { subscriptionId: { in: subIds } } })).count);
  note("SubscriptionModule", (await tx.subscriptionModule.deleteMany({ where: { subscriptionId: { in: subIds } } })).count);
  note("Subscription", (await tx.subscription.deleteMany({ where: { id: { in: subIds } } })).count);

  note("Supplier", (await tx.supplier.deleteMany({ where: { clientId: { in: clientIds } } })).count);
  note("ClientItemUnitDefault", (await tx.clientItemUnitDefault.deleteMany({ where: { clientId: { in: clientIds } } })).count);
  note("UserClientAccess", (await tx.userClientAccess.deleteMany({ where: { clientId: { in: clientIds } } })).count);
  note("Setting (client-scoped)", (await tx.setting.deleteMany({ where: { clientId: { in: clientIds } } })).count);
  note("Client", (await tx.client.deleteMany({ where: { id: { in: clientIds } } })).count);
}

async function removeDemoUsers(tx: Tx, userIds: string[]) {
  note("AuthSession", (await tx.authSession.deleteMany({ where: { userId: { in: userIds } } })).count);
  note("MfaChallenge", (await tx.mfaChallenge.deleteMany({ where: { userId: { in: userIds } } })).count);
  note("UserMfa", (await tx.userMfa.deleteMany({ where: { userId: { in: userIds } } })).count);
  note("UserModule", (await tx.userModule.deleteMany({ where: { userId: { in: userIds } } })).count);
  note("UserItemUnitPreference", (await tx.userItemUnitPreference.deleteMany({ where: { userId: { in: userIds } } })).count);
  note("DevicePin (user)", (await tx.devicePin.deleteMany({ where: { userId: { in: userIds } } })).count);
  note("UserClientAccess (user)", (await tx.userClientAccess.deleteMany({ where: { userId: { in: userIds } } })).count);
  note("User", (await tx.user.deleteMany({ where: { id: { in: userIds } } })).count);
}

/**
 * Items are GLOBAL, not client-scoped, so demo products survive the client
 * delete as catalog entries nobody stocks. "Demo" here means: not recorded in
 * LegacyMap and not stocked by any surviving location. Both conditions, so a
 * legacy item that happens to be unstocked is never caught by this.
 */
async function removeOrphanDemoItems(tx: Tx) {
  const migratedItemIds = new Set(
    (await tx.legacyMap.findMany({ where: { legacyTable: "bottles" }, select: { newId: true } })).map((r) => r.newId),
  );

  const variants = await tx.itemVariant.findMany({
    select: { id: true, itemId: true, _count: { select: { locationItems: true } } },
  });
  const doomedVariants = variants.filter((v) => !migratedItemIds.has(v.itemId) && v._count.locationItems === 0);
  const doomedVariantIds = doomedVariants.map((v) => v.id);

  note("ItemVariant (demo, unstocked)", (await tx.itemVariant.deleteMany({ where: { id: { in: doomedVariantIds } } })).count);

  const items = await tx.item.findMany({ select: { id: true, _count: { select: { variants: true } } } });
  const doomedItems = items.filter((i) => !migratedItemIds.has(i.id) && i._count.variants === 0).map((i) => i.id);
  note("Item (demo, no variants left)", (await tx.item.deleteMany({ where: { id: { in: doomedItems } } })).count);
}

class DryRunRollback extends Error {}

async function main() {
  const confirm = process.argv.includes("--confirm");

  const demoClients = await prisma.client.findMany({
    where: { name: { notIn: MIGRATED_CLIENTS } },
    select: { id: true, name: true, locations: { select: { id: true } } },
  });
  const demoUsers = await prisma.user.findMany({
    where: { username: { in: DEMO_USERNAMES } },
    select: { id: true, username: true, role: true },
  });

  console.log(`\nDemo clients to remove: ${demoClients.map((c) => c.name).join(", ") || "(none)"}`);
  console.log(`Demo users to remove:   ${demoUsers.map((u) => u.username).join(", ") || "(none)"}`);

  // An ACTIVE ADMIN that this script is NOT about to delete.
  const survivingAdmins = await prisma.user.count({
    where: { role: "ADMIN", status: "ACTIVE", username: { notIn: DEMO_USERNAMES } },
  });
  if (demoUsers.some((u) => u.role === "ADMIN") && survivingAdmins === 0) {
    throw new Error(
      [
        "REFUSING: this would delete every ACTIVE ADMIN and leave no way to log in.",
        "Every migrated user is DISABLED with an unusable password hash, by design.",
        "Create a real administrator first:",
        "  FNB_ADMIN_USER=<name> npm run db:bootstrap -w @fnb/server",
        "then re-run this script.",
      ].join("\n"),
    );
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await removeDemoClients(
          tx,
          demoClients.map((c) => c.id),
          demoClients.flatMap((c) => c.locations.map((l) => l.id)),
        );
        await removeDemoUsers(
          tx,
          demoUsers.map((u) => u.id),
        );
        await removeOrphanDemoItems(tx);
        if (!confirm) throw new DryRunRollback();
      },
      { timeout: 10 * 60_000, maxWait: 60_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }

  console.log(`\n===== ${confirm ? "DELETED" : "DRY RUN - nothing written"} =====`);
  for (const [label, n] of tally) console.log(`  ${label.padEnd(30)} ${String(n).padStart(6)}`);
  console.log("\n  ActivityLog left intact on purpose: it is hash-chained, and deleting rows");
  console.log("  would break the chain the verifier depends on.\n");
  if (!confirm) console.log("Pass --confirm to apply.\n");
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  });
