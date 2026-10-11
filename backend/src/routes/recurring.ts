import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { recurringFields } from "../lib/sync/schemas";
import { stampTombstones } from "../lib/sync/sql";
import { dbNow } from "../lib/distributed/clock";
import { keepsBookingState, runRecurringNow } from "../jobs/recurring-booking";

/**
 * Recurring series. The phone syncs them through /sync (Phase 4, entity
 * `recurring`); these routes write the same rows and follow the same model:
 * every write stamps clientUpdatedAt from the database clock (a server write
 * wins over an older phone copy, Phase 4 decision 4), a delete leaves a
 * tombstone carrying that time, and an account named here must be the
 * caller's own (400 otherwise; Phase 4 decision 5).
 */

// The field rules are shared with the sync rows (lib/sync/schemas.ts).
const recurringSchema = z.object({
  accountId: recurringFields.accountId.optional(),
  name: recurringFields.name,
  amount: recurringFields.amount,
  category: recurringFields.category,
  type: recurringFields.type,
  isImpulse: recurringFields.isImpulse.optional().default(false),
  frequency: recurringFields.frequency,
  startDate: recurringFields.startDate,
  nextDate: recurringFields.nextDate,
  currency: recurringFields.currency.optional().default("USD"),
});

// Every field optional and none defaulted: a field left out keeps its value.
// The app sends the whole row it read back (with lastCreated null for a series
// never booked), so null is accepted where the column allows it.
const recurringUpdateSchema = z.object({
  accountId: recurringFields.accountId.optional(),
  name: recurringFields.name.optional(),
  amount: recurringFields.amount.optional(),
  category: recurringFields.category.optional(),
  type: recurringFields.type.optional(),
  isImpulse: recurringFields.isImpulse.optional(),
  frequency: recurringFields.frequency.optional(),
  startDate: recurringFields.startDate.optional(),
  nextDate: recurringFields.nextDate.optional(),
  lastCreated: recurringFields.lastCreated.optional(),
  isActive: recurringFields.isActive.optional(),
  currency: recurringFields.currency.optional(),
});

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

const NOT_YOUR_ACCOUNT = { error: "accountId is not one of your accounts", code: "invalid_account" } as const;

/**
 * Whether `userId` owns `accountId`, locking it against deletion until the
 * write commits (the foreign key would refuse the write otherwise). Taken
 * before the series row, the order a sync push and the booking lock in.
 */
async function lockOwnAccount(tx: Prisma.TransactionClient, userId: string, accountId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BankAccount" WHERE "id" = ${accountId} AND "userId" = ${userId} FOR KEY SHARE`;
  return rows.length === 1;
}

router.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const recurring = await prisma.recurringTransaction.findMany({
    where: { userId: user.id },
    orderBy: [{ nextDate: "asc" }, { id: "asc" }],
  });
  return c.json(recurring);
});

router.post("/", zValidator("json", recurringSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");
  const accountId = body.accountId || null;
  const recurring = await prisma.$transaction(async (tx) => {
    if (accountId && !(await lockOwnAccount(tx, user.id, accountId))) return null;
    return tx.recurringTransaction.create({
      data: {
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        userId: user.id,
        accountId,
        name: body.name,
        amount: body.amount,
        category: body.category,
        type: body.type,
        isImpulse: body.isImpulse,
        frequency: body.frequency,
        startDate: body.startDate,
        nextDate: body.nextDate,
        isActive: true,
        currency: body.currency,
        clientUpdatedAt: await dbNow(tx),
      },
    });
  });
  if (!recurring) return c.json(NOT_YOUR_ACCOUNT, 400);
  return c.json(recurring, 201);
});

// PUT changes only what it is sent. accountId, when sent, links one of the
// caller's accounts (or with null unlinks); any other is a 400.
//
// The booking state is kept when the request has not seen the latest booking
// (keepsBookingState): an app that read the series before the job or run-now
// booked it, then saved it, would otherwise move nextDate back to a date
// already booked, and the job would book the next day again.
router.put("/:id", zValidator("json", recurringUpdateSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = c.req.valid("json");
  const accountId = body.accountId === undefined ? undefined : body.accountId || null;

  const outcome = await prisma.$transaction(async (tx) => {
    if (accountId && !(await lockOwnAccount(tx, user.id, accountId))) return "invalid_account" as const;
    const [stored] = await tx.$queryRaw<{ lastCreated: string | null }[]>`
      SELECT "lastCreated" FROM "RecurringTransaction" WHERE "id" = ${id} AND "userId" = ${user.id} FOR UPDATE`;
    if (!stored) return "not_found" as const;
    const keep = keepsBookingState(stored.lastCreated, body.lastCreated);
    return tx.recurringTransaction.update({
      where: { id, userId: user.id },
      data: {
        accountId,
        name: body.name,
        amount: body.amount,
        category: body.category,
        type: body.type,
        isImpulse: body.isImpulse,
        frequency: body.frequency,
        startDate: body.startDate,
        nextDate: keep ? undefined : body.nextDate,
        lastCreated: keep ? undefined : body.lastCreated,
        isActive: body.isActive,
        currency: body.currency,
        clientUpdatedAt: await dbNow(tx),
      },
    });
  });
  if (outcome === "invalid_account") return c.json(NOT_YOUR_ACCOUNT, 400);
  if (outcome === "not_found") return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(outcome);
});

// ─── run now ──────────────────────────────────────────────────────────────────
// POST /recurring/:id/run — book today's occurrence now, owner only.
//
// Replaces what the app used to do itself: post a transaction and then set
// nextDate to today, after which the job booked a second one. This books
// through the job's own code (jobs/recurring-booking.ts) under the job's own
// occurrence id, tx_rec_<id>_<YYYY-MM-DD> (UTC), so the two can never both
// book a day, on one instance or several. The booked row, and the series
// moved past today, reach the phone through sync like any server write.
//
// 201 { transactionId, nextDate } when this call booked it; 200 with the same
// id when today's occurrence was already booked. A series that is not the
// caller's is 404, the same as one that does not exist.
router.post("/:id/run", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const result = await runRecurringNow(c.req.param("id"), user.id);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json({ transactionId: result.transactionId, nextDate: result.nextDate }, result.status);
});

router.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.$transaction(async (tx) => {
    await tx.recurringTransaction.delete({ where: { id, userId: user.id } });
    // The tombstone the trigger wrote carries the row's last edit time; the
    // delete happened now, and a phone's older edit must not undo it.
    const now = (await dbNow(tx)).getTime();
    await stampTombstones(tx, user.id, "recurring", [{ id, cu: now }], { insertMissing: false });
  });
  return c.json({ success: true });
});

export { router as recurringRouter };
