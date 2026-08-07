import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { dateString } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { findOverlap } from "../lib/period-lock";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { logActivity } from "../services/activity";

/**
 * Closing and reopening a period (Phase 2, 2026-08-06).
 *
 * The client's question was whether a revised Final Report can be compared
 * against the original. Phase 1 answers that. This answers the question
 * underneath it: why was a final report revised at all? Because nothing ever
 * said a period was finished. A lock says so, and makes it true.
 *
 * Locking is a MANAGER act, not an admin one — the person who signs off the
 * count is the person who closes the books on it. Releasing needs the same
 * right plus a reason, because a reopened period is the single most
 * interesting event in this table to anyone auditing later.
 */

const lockGuard = requirePermission("entries.void");

const lockRequest = z.object({
  begin: dateString,
  end: dateString,
  reason: z.string().trim().max(300).optional(),
});

const releaseRequest = z.object({
  reason: z.string().trim().min(3, "Say why the period is being reopened").max(300),
});

export const periodLockRoutes = new Hono<AppEnv>()
  .get("/period-locks", async (c) => {
    const location = c.get("location");
    const locks = await prisma.periodLock.findMany({
      where: { locationId: location.id },
      orderBy: [{ status: "asc" }, { begin: "desc" }],
    });
    return c.json({ locks });
  })

  .post("/period-locks", lockGuard, zValidator("json", lockRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { begin, end, reason } = c.req.valid("json");
    if (end < begin) throw new AppError(400, "The closing date cannot be before the opening date");

    const clash = await findOverlap(location.id, begin, end);
    if (clash) {
      throw new AppError(
        409,
        `${clash.begin} to ${clash.end} is already closed, and the two ranges overlap. Reopen that period first, or pick dates outside it.`,
        "PERIOD_OVERLAP",
      );
    }

    const lock = await prisma.$transaction(async (tx) => {
      const created = await tx.periodLock.create({
        data: {
          locationId: location.id,
          begin,
          end,
          reason: reason || null,
          lockedById: user.id,
          lockedByName: `${user.firstName} ${user.lastName}`,
        },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "period.lock",
          entity: "PeriodLock",
          entityId: created.id,
          summary: `Closed ${begin} → ${end}${reason ? `: ${reason}` : ""}`,
          details: { begin, end },
        },
        tx,
      );
      return created;
    });
    return c.json(lock, 201);
  })

  /**
   * Reopen. RELEASED, never deleted: "this period was reopened on the 12th by
   * Maria because the client disputed the ending count" is exactly the sort of
   * thing an audit exists to be able to say, and a deleted row says nothing.
   */
  .post("/period-locks/:id/release", lockGuard, zValidator("json", releaseRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    const lock = await prisma.periodLock.findUnique({ where: { id: c.req.param("id") } });
    if (!lock || lock.locationId !== location.id) throw new AppError(404, "Closed period not found");
    if (lock.status !== "LOCKED") throw new AppError(409, "That period is already open");

    const released = await prisma.$transaction(async (tx) => {
      // Compare-and-set, same discipline as every other status flip here: two
      // simultaneous releases would otherwise both write, and the trail would
      // credit whichever landed second.
      const { count } = await tx.periodLock.updateMany({
        where: { id: lock.id, status: "LOCKED" },
        data: {
          status: "RELEASED",
          releasedAt: new Date(),
          releasedById: user.id,
          releaseReason: reason,
        },
      });
      if (count === 0) throw new AppError(409, "That period was reopened by someone else a moment ago");
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "period.release",
          entity: "PeriodLock",
          entityId: lock.id,
          summary: `Reopened ${lock.begin} → ${lock.end}: ${reason}`,
          details: { begin: lock.begin, end: lock.end, reason },
        },
        tx,
      );
      return tx.periodLock.findUniqueOrThrow({ where: { id: lock.id } });
    });
    return c.json(released);
  });
