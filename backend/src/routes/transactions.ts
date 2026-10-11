import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { transactionFields } from "../lib/sync/schemas";
import { stampTombstones } from "../lib/sync/sql";

/**
 * Transaction CRUD. The phone syncs through /sync (routes/sync.ts); these
 * routes write the same rows, so they follow the same model: every write is
 * stamped with clientUpdatedAt = now (the server's time, decision 5), a delete
 * leaves a tombstone carrying that time, and an account the caller does not
 * own is never linked. The old bulk POST /transactions/sync is gone.
 */

// The field rules are shared with the sync rows (lib/sync/schemas.ts).
const transactionSchema = z.object({
  amount: transactionFields.amount,
  category: transactionFields.category,
  type: transactionFields.type,
  isImpulse: transactionFields.isImpulse.optional().default(false),
  note: transactionFields.note.optional(),
  dateISO: transactionFields.dateISO,
  accountId: transactionFields.accountId.optional(),
  currency: transactionFields.currency.optional().default("USD"),
});

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard for all transaction routes
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

/**
 * The account to store: the requested one when the caller owns it, otherwise
 * null — the rule a sync push applies (I-WIRE). Linking to someone else's
 * account id used to be accepted as-is.
 */
async function ownAccountOrNull(userId: string, accountId: string | null | undefined): Promise<string | null> {
  if (!accountId) return null;
  const owned = await prisma.bankAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  return owned ? owned.id : null;
}

// GET all transactions for user
router.get("/", async (c) => {
  const user = c.get("user")!;

  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 100);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id },
      // id breaks ties: Postgres has no implicit row order, and rows on the
      // same day would otherwise move between pages.
      orderBy: [{ dateISO: "desc" }, { id: "asc" }],
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where: { userId: user.id } }),
  ]);

  return c.json({ data: transactions, pagination: { limit, offset, total, hasMore: offset + limit < total } });
});

// POST create transaction
router.post("/", zValidator("json", transactionSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");

  const transaction = await prisma.transaction.create({
    data: {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      accountId: await ownAccountOrNull(user.id, body.accountId),
      amount: body.amount,
      category: body.category,
      type: body.type,
      isImpulse: body.isImpulse,
      note: body.note || null,
      dateISO: body.dateISO,
      currency: body.currency,
      clientUpdatedAt: new Date(),
    },
  });
  return c.json(transaction, 201);
});

// PUT update transaction. Fields left out keep their value; accountId, when
// sent, links (or with null unlinks) an account the caller owns.
router.put("/:id", zValidator("json", transactionSchema.partial()), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  // .partial() keeps the defaults, so a field the request left out would come
  // back as false/"USD" and overwrite the stored value; only what was sent counts.
  const raw = (await c.req.json()) as Record<string, unknown>;
  const body = c.req.valid("json");
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);

  const transaction = await prisma.transaction.update({
    where: { id, userId: user.id },
    data: {
      amount: body.amount,
      category: body.category,
      type: body.type,
      isImpulse: sent("isImpulse") ? body.isImpulse : undefined,
      note: body.note,
      dateISO: body.dateISO,
      currency: sent("currency") ? body.currency : undefined,
      accountId: sent("accountId") ? await ownAccountOrNull(user.id, body.accountId) : undefined,
      clientUpdatedAt: new Date(),
    },
  });
  return c.json(transaction);
});

// DELETE transaction
router.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  await prisma.$transaction(async (tx) => {
    await tx.transaction.delete({ where: { id, userId: user.id } });
    // The tombstone the trigger wrote carries the row's last edit time; the
    // delete happened now, and a device's older edit must not undo it.
    await stampTombstones(tx, user.id, "transactions", [{ id, cu: Date.now() }], { insertMissing: false });
  });
  return c.json({ success: true });
});

export { router as transactionsRouter };
