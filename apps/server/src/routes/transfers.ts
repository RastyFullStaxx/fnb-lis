import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  allowedProductTypes,
  can,
  lineTotal,
  transferCreate,
  transferLineCreate,
  transferReceive,
  voidRequest,
  type Role,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";

/**
 * Inter-location transfers (client reqs #10/#13). One Transfer document has
 * two sides:
 *   SOURCE  (fromLocation) — drafts, adds lines, commits, voids/corrects lines
 *   DESTINATION (toLocation) — receives against committed lines, voids/corrects receipts
 * Mutations are only accepted from the side they belong to; either side may read.
 *
 * Void ordering rule: a transfer or line cannot be voided while an ACTIVE
 * receipt exists against it — the destination voids its receipt first. This
 * keeps both locations' books consistent and the audit trail in cause→effect
 * order.
 */

const createGuard = requirePermission("entries.create");
const voidGuard = requirePermission("entries.void");

const LI_INCLUDE = {
  locationItem: { include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } } },
} as const;
const LINE_INCLUDE = {
  ...LI_INCLUDE,
  receipts: { where: { status: "ACTIVE" }, select: { id: true, qtyReceived: true, receiptDate: true, note: true } },
} as const;

async function getOwnedTransfer(locationId: string, transferId: string) {
  const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
  if (!transfer || (transfer.fromLocationId !== locationId && transfer.toLocationId !== locationId)) {
    throw new AppError(404, "Transfer not found");
  }
  return transfer;
}

function requireSourceSide(transfer: { fromLocationId: string }, locationId: string) {
  if (transfer.fromLocationId !== locationId) {
    throw new AppError(403, "Only the sending location can do this");
  }
}

function requireDestinationSide(transfer: { toLocationId: string }, locationId: string) {
  if (transfer.toLocationId !== locationId) {
    throw new AppError(403, "Only the receiving location can do this");
  }
}

/** Runs inside the caller's $transaction so the guard and the void are atomic. */
async function activeReceiptCount(
  tx: { transferReceiptLine: { count: (args: object) => Promise<number> } },
  where: { transferId?: string; transferLineId?: string },
): Promise<number> {
  return tx.transferReceiptLine.count({
    where: {
      status: "ACTIVE",
      ...(where.transferLineId
        ? { transferLineId: where.transferLineId }
        : { transferLine: { transferId: where.transferId } }),
    },
  });
}

export const transferRoutes = new Hono<AppEnv>()
  .get("/transfers", async (c) => {
    const location = c.get("location");
    const direction = c.req.query("direction") === "in" ? "in" : "out";
    const transfers = await prisma.transfer.findMany({
      where:
        direction === "out"
          ? { fromLocationId: location.id }
          : // The destination only sees real documents: committed transfers,
            // plus voids that had actually been committed first. A draft the
            // source discarded before committing never reaches this inbox.
            {
              toLocationId: location.id,
              OR: [{ status: "COMMITTED" }, { status: "VOID", committedAt: { not: null } }],
            },
      include: {
        fromLocation: { select: { id: true, name: true, kind: true } },
        toLocation: { select: { id: true, name: true, kind: true } },
        lines: {
          where: { status: "ACTIVE" },
          select: { qty: true, lineTotal: true, receipts: { where: { status: "ACTIVE" }, select: { id: true } } },
        },
      },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return c.json(
      transfers.map(({ lines, ...t }) => ({
        ...t,
        lineCount: lines.length,
        total: lines.reduce((s, l) => s + l.lineTotal, 0),
        receivedCount: lines.filter((l) => l.receipts.length > 0).length,
      })),
    );
  })

  .post("/transfers", createGuard, zValidator("json", transferCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");

    if (body.toLocationId === location.id) throw new AppError(400, "A location can't transfer stock to itself");
    const toLocation = await prisma.location.findUnique({ where: { id: body.toLocationId } });
    // Tenant isolation: the destination must be another location of the SAME
    // client. Without this a crafted request could point a transfer at another
    // client's books — neither requireLocationAccess nor the permission guard
    // checks the second location.
    if (!toLocation || toLocation.clientId !== location.clientId) {
      throw new AppError(404, "Destination location not found for this client");
    }
    if (toLocation.status !== "ACTIVE") throw new AppError(400, "Destination location is archived");

    const transfer = await prisma.$transaction(async (tx) => {
      const created = await tx.transfer.create({
        data: {
          fromLocationId: location.id,
          toLocationId: toLocation.id,
          businessDate: body.businessDate,
          note: body.note ?? null,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
        include: { toLocation: { select: { id: true, name: true, kind: true } } },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "transfer.create", entity: "Transfer", entityId: created.id,
          summary: `Started transfer draft to "${toLocation.name}" for ${body.businessDate}`,
          details: { toLocationId: toLocation.id },
        },
        tx,
      );
      return created;
    });
    return c.json(transfer, 201);
  })

  .get("/transfers/:id", async (c) => {
    const location = c.get("location");
    const transfer = await prisma.transfer.findUnique({
      where: { id: c.req.param("id") },
      include: {
        fromLocation: { select: { id: true, name: true, kind: true } },
        toLocation: { select: { id: true, name: true, kind: true } },
        lines: { include: LINE_INCLUDE, orderBy: { createdAt: "asc" } },
      },
    });
    if (!transfer || (transfer.fromLocationId !== location.id && transfer.toLocationId !== location.id)) {
      throw new AppError(404, "Transfer not found");
    }
    // The source's work-in-progress is private until commit — the destination
    // only ever sees the document once it's real (mirrors the list filter).
    if (transfer.status === "DRAFT" && transfer.fromLocationId !== location.id) {
      throw new AppError(404, "Transfer not found");
    }
    return c.json(transfer);
  })

  .put("/transfers/:id", createGuard, zValidator("json", transferCreate.partial()), async (c) => {
    const location = c.get("location");
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireSourceSide(transfer, location.id);
    if (transfer.status !== "DRAFT") throw new AppError(409, "Only drafts can be edited");
    const body = c.req.valid("json");
    if (body.toLocationId !== undefined) {
      if (body.toLocationId === location.id) throw new AppError(400, "A location can't transfer stock to itself");
      const toLocation = await prisma.location.findUnique({ where: { id: body.toLocationId } });
      if (!toLocation || toLocation.clientId !== location.clientId) {
        throw new AppError(404, "Destination location not found for this client");
      }
      if (toLocation.status !== "ACTIVE") throw new AppError(400, "Destination location is archived");
    }
    const updated = await prisma.transfer.update({ where: { id: transfer.id }, data: body });
    return c.json(updated);
  })

  .post("/transfers/:id/lines", createGuard, zValidator("json", transferLineCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireSourceSide(transfer, location.id);
    if (transfer.status !== "DRAFT") throw new AppError(409, "Committed transfers take corrections, not new draft lines");
    const body = c.req.valid("json");
    const locationItem = await prisma.locationItem.findUnique({ where: { id: body.locationItemId } });
    if (!locationItem || locationItem.locationId !== location.id) throw new AppError(404, "Item not found in this catalog");
    const unitCost = body.unitCost ?? locationItem.cost;
    const line = await prisma.transferLine.create({
      data: {
        transferId: transfer.id,
        locationItemId: body.locationItemId,
        qty: body.qty,
        unitCost,
        lineTotal: lineTotal(body.qty, unitCost),
        createdById: user.id,
        createdByName: `${user.firstName} ${user.lastName}`,
      },
      include: LINE_INCLUDE,
    });
    return c.json(line, 201);
  })

  .delete("/transfers/:id/lines/:lineId", createGuard, async (c) => {
    const location = c.get("location");
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireSourceSide(transfer, location.id);
    if (transfer.status !== "DRAFT") throw new AppError(409, "Committed lines cannot be removed — void instead");
    // The line must actually belong to THIS draft — a raw delete by id would
    // reach any TransferLine in the database, including other clients'.
    const line = await prisma.transferLine.findUnique({ where: { id: c.req.param("lineId") } });
    if (!line || line.transferId !== transfer.id) throw new AppError(404, "Transfer line not found");
    await prisma.transferLine.delete({ where: { id: line.id } });
    return c.json({ ok: true });
  })

  .post("/transfers/:id/commit", createGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireSourceSide(transfer, location.id);
    if (transfer.status !== "DRAFT") throw new AppError(409, "Already committed");

    const lines = await prisma.transferLine.findMany({
      where: { transferId: transfer.id, status: "ACTIVE" },
      include: LI_INCLUDE,
    });
    if (lines.length === 0) throw new AppError(400, "Add at least one line before committing");

    // Module firewall at commit time: every item must be stockable under the
    // DESTINATION's module set. Fails loudly on the sender's screen instead of
    // arriving dead at the receiver (mirrors the copy-from filter, but as a
    // hard error — a transfer is a deliberate document, not a bulk convenience).
    const toModules = await prisma.locationModule.findMany({ where: { locationId: transfer.toLocationId } });
    const allowed = allowedProductTypes(toModules.map((m) => m.module));
    if (allowed) {
      const blocked = lines.filter((l) => !allowed.includes(l.locationItem.itemVariant.item.category.productType));
      if (blocked.length > 0) {
        const names = blocked.map((l) => l.locationItem.itemVariant.item.name).join(", ");
        throw new AppError(400, `The destination's modules don't cover: ${names}. Remove those lines or widen the destination's modules.`);
      }
    }

    const committed = await prisma.$transaction(async (tx) => {
      const updated = await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: "COMMITTED", committedAt: new Date(), committedById: user.id },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "transfer.commit", entity: "Transfer", entityId: transfer.id,
          summary: `Committed transfer for ${transfer.businessDate} (${lines.length} lines)`,
          details: { toLocationId: transfer.toLocationId },
        },
        tx,
      );
      return updated;
    });
    return c.json(committed);
  })

  // ── Destination side: receive ──
  .post("/transfers/:id/receive", createGuard, zValidator("json", transferReceive), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireDestinationSide(transfer, location.id);
    if (transfer.status !== "COMMITTED") throw new AppError(409, "Only committed transfers can be received");
    const body = c.req.valid("json");

    // One entry per line — duplicates would each pass the already-received
    // check against the same pre-insert snapshot.
    const lineIds = body.lines.map((l) => l.transferLineId);
    if (new Set(lineIds).size !== lineIds.length) {
      throw new AppError(400, "Duplicate transfer line in the receipt");
    }

    const created = await prisma.$transaction(async (tx) => {
      // Validate INSIDE the transaction so a concurrent receive can't slip a
      // second ACTIVE receipt past a stale snapshot (single-writer SQLite
      // serializes the transactions; the check and the insert are now atomic).
      const lines = await tx.transferLine.findMany({
        where: { id: { in: lineIds } },
        include: { locationItem: true, receipts: { where: { status: "ACTIVE" }, select: { id: true } } },
      });
      const byId = new Map(lines.map((l) => [l.id, l]));
      for (const entry of body.lines) {
        const line = byId.get(entry.transferLineId);
        if (!line || line.transferId !== transfer.id) throw new AppError(404, "Transfer line not found on this transfer");
        if (line.status !== "ACTIVE") throw new AppError(409, "That line was voided by the sender");
        if (line.receipts.length > 0) throw new AppError(409, "That line is already received — void or correct the existing receipt instead");
      }

      const receipts = [];
      const autoCreated: string[] = [];
      for (const entry of body.lines) {
        const line = byId.get(entry.transferLineId)!;
        // Map the source catalog row to the destination's catalog via the
        // shared item variant; auto-create the destination row if missing
        // (same shape as location-items copy-from — commit already proved the
        // destination's modules cover it).
        let toItem = await tx.locationItem.findUnique({
          where: {
            locationId_itemVariantId: {
              locationId: transfer.toLocationId,
              itemVariantId: line.locationItem.itemVariantId,
            },
          },
        });
        if (!toItem) {
          toItem = await tx.locationItem.create({
            data: {
              locationId: transfer.toLocationId,
              itemVariantId: line.locationItem.itemVariantId,
              cost: line.locationItem.cost,
              retail: line.locationItem.retail,
              updatedById: user.id,
            },
          });
          autoCreated.push(toItem.id);
        }
        receipts.push(
          await tx.transferReceiptLine.create({
            data: {
              transferLineId: line.id,
              toLocationItemId: toItem.id,
              qtyReceived: entry.qtyReceived,
              receiptDate: body.receiptDate,
              note: entry.note ?? null,
              createdById: user.id,
              createdByName: `${user.firstName} ${user.lastName}`,
            },
          }),
        );
      }
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "transfer.receive", entity: "Transfer", entityId: transfer.id,
          summary: `Received ${receipts.length} line(s) on ${body.receiptDate}`,
          details: { fromLocationId: transfer.fromLocationId, autoCreatedLocationItems: autoCreated },
        },
        tx,
      );
      return receipts;
    });
    return c.json(created, 201);
  })

  .post("/transfers/:id/receipts/:receiptId/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireDestinationSide(transfer, location.id);
    const receipt = await prisma.transferReceiptLine.findUnique({
      where: { id: c.req.param("receiptId") },
      include: { transferLine: true },
    });
    if (!receipt || receipt.transferLine.transferId !== transfer.id) throw new AppError(404, "Receipt not found");
    if (receipt.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.transferReceiptLine.update({
        where: { id: receipt.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "transferReceipt.void", entity: "TransferReceiptLine", entityId: receipt.id,
          summary: `Voided a transfer receipt (${receipt.qtyReceived} received): ${reason}`,
        },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  // Correction = void + linked replacement in one transaction (sales.ts pattern).
  .post(
    "/transfers/:id/receipts/:receiptId/correct",
    voidGuard,
    zValidator("json", voidRequest.and(transferReceive.shape.lines.element.pick({ qtyReceived: true, note: true }))),
    async (c) => {
      const location = c.get("location");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
      requireDestinationSide(transfer, location.id);
      const receipt = await prisma.transferReceiptLine.findUnique({
        where: { id: c.req.param("receiptId") },
        include: { transferLine: true },
      });
      if (!receipt || receipt.transferLine.transferId !== transfer.id) throw new AppError(404, "Receipt not found");
      if (receipt.status === "VOID") throw new AppError(409, "Already voided — correct the replacement instead");

      const replacement = await prisma.$transaction(async (tx) => {
        await tx.transferReceiptLine.update({
          where: { id: receipt.id },
          data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: body.reason },
        });
        const created = await tx.transferReceiptLine.create({
          data: {
            transferLineId: receipt.transferLineId,
            toLocationItemId: receipt.toLocationItemId,
            qtyReceived: body.qtyReceived,
            receiptDate: receipt.receiptDate,
            note: body.note ?? receipt.note,
            correctionOfId: receipt.id,
            createdById: user.id,
            createdByName: `${user.firstName} ${user.lastName}`,
          },
        });
        await logActivity(
          {
            user, clientId: location.clientId, locationId: location.id,
            action: "transferReceipt.correct", entity: "TransferReceiptLine", entityId: created.id,
            summary: `Corrected a transfer receipt ${receipt.qtyReceived} → ${body.qtyReceived}: ${body.reason}`,
            details: { correctionOfId: receipt.id },
          },
          tx,
        );
        return created;
      });
      return c.json(replacement, 201);
    },
  )

  // ── Source side: voids & corrections ──
  // createGuard, not voidGuard: discarding one's own DRAFT is entry-level
  // work; voiding a COMMITTED document stays a manager action (checked below).
  .post("/transfers/:id/void", createGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireSourceSide(transfer, location.id);
    if (transfer.status === "VOID") throw new AppError(409, "Already voided");
    if (transfer.status !== "DRAFT" && !can(user.role as Role, "entries.void")) {
      throw new AppError(403, "You don't have permission for this action");
    }
    const voided = await prisma.$transaction(async (tx) => {
      if ((await activeReceiptCount(tx, { transferId: transfer.id })) > 0) {
        throw new AppError(409, "The destination has active receipts against this transfer — they must void those first");
      }
      const updated = await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "transfer.void", entity: "Transfer", entityId: transfer.id,
          summary: `Voided transfer for ${transfer.businessDate}: ${reason}`,
          details: { toLocationId: transfer.toLocationId },
        },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  .post("/transfers/:id/lines/:lineId/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
    requireSourceSide(transfer, location.id);
    const line = await prisma.transferLine.findUnique({ where: { id: c.req.param("lineId") }, include: LI_INCLUDE });
    if (!line || line.transferId !== transfer.id) throw new AppError(404, "Transfer line not found");
    if (line.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      if ((await activeReceiptCount(tx, { transferLineId: line.id })) > 0) {
        throw new AppError(409, "The destination has an active receipt for this line — they must void it first");
      }
      const updated = await tx.transferLine.update({
        where: { id: line.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
        include: LI_INCLUDE,
      });
      await logActivity(
        {
          user, clientId: location.clientId, locationId: location.id,
          action: "transferLine.void", entity: "TransferLine", entityId: line.id,
          summary: `Voided transfer line (${line.locationItem.itemVariant.item.name} ×${line.qty}): ${reason}`,
        },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  .post(
    "/transfers/:id/lines/:lineId/correct",
    voidGuard,
    zValidator("json", voidRequest.and(transferLineCreate.pick({ qty: true, unitCost: true }))),
    async (c) => {
      const location = c.get("location");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const transfer = await getOwnedTransfer(location.id, c.req.param("id"));
      requireSourceSide(transfer, location.id);
      if (transfer.status !== "COMMITTED") throw new AppError(409, "Only committed transfers take corrections");
      const line = await prisma.transferLine.findUnique({ where: { id: c.req.param("lineId") }, include: LI_INCLUDE });
      if (!line || line.transferId !== transfer.id) throw new AppError(404, "Transfer line not found");
      if (line.status === "VOID") throw new AppError(409, "Already voided — correct the replacement instead");
      const unitCost = body.unitCost ?? line.unitCost;
      const replacement = await prisma.$transaction(async (tx) => {
        if ((await activeReceiptCount(tx, { transferLineId: line.id })) > 0) {
          throw new AppError(409, "The destination has an active receipt for this line — they must void it first");
        }
        await tx.transferLine.update({
          where: { id: line.id },
          data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: body.reason },
        });
        const created = await tx.transferLine.create({
          data: {
            transferId: transfer.id,
            locationItemId: line.locationItemId,
            qty: body.qty,
            unitCost,
            lineTotal: lineTotal(body.qty, unitCost),
            correctionOfId: line.id,
            createdById: user.id,
            createdByName: `${user.firstName} ${user.lastName}`,
          },
          include: LINE_INCLUDE,
        });
        await logActivity(
          {
            user, clientId: location.clientId, locationId: location.id,
            action: "transferLine.correct", entity: "TransferLine", entityId: created.id,
            summary: `Corrected transfer line (${line.locationItem.itemVariant.item.name}) ×${line.qty} → ×${body.qty}: ${body.reason}`,
            details: { correctionOfId: line.id },
          },
          tx,
        );
        return created;
      });
      return c.json(replacement, 201);
    },
  );
