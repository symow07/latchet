import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { MAX_SYNC_ROWS } from "../lib/schemas";

const transactionSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  // Free-form, not an enum: users can create their own categories (see
  // mobile/src/lib/categories.ts) and Transaction.category is a plain String
  // in the schema. An enum here silently dropped every custom-category row
  // during bulk sync, because /sync skips whatever fails to parse.
  category: z.string().min(1).max(50),
  type: z.enum(["Expense", "Income"]),
  isImpulse: z.boolean().optional().default(false),
  note: z.string().max(500).optional().nullable(),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  accountId: z.string().optional().nullable(),
  currency: z.string().min(1).max(5).optional().default("USD"),
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

// GET all transactions for user
router.get("/", async (c) => {
  const user = c.get("user")!;

  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 100);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { dateISO: "desc" },
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
      accountId: body.accountId || null,
      amount: body.amount,
      category: body.category,
      type: body.type,
      isImpulse: body.isImpulse,
      note: body.note || null,
      dateISO: body.dateISO,
      currency: body.currency,
    },
  });
  return c.json(transaction, 201);
});

// PUT update transaction
router.put("/:id", zValidator("json", transactionSchema.partial()), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const body = c.req.valid("json");

  const transaction = await prisma.transaction.update({
    where: { id, userId: user.id },
    data: {
      amount: body.amount,
      category: body.category,
      type: body.type,
      isImpulse: body.isImpulse,
      note: body.note,
      dateISO: body.dateISO,
      currency: body.currency,
    },
  });
  return c.json(transaction);
});

// DELETE transaction
router.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  await prisma.transaction.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

// POST bulk sync — validates ownership before upsert
router.post("/sync", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json();
  const { transactions } = body;

  if (!Array.isArray(transactions)) return c.json({ error: "Invalid payload" }, 400);
  if (transactions.length > MAX_SYNC_ROWS) {
    return c.json(
      {
        error: `Too many transactions in one request (max ${MAX_SYNC_ROWS})`,
        code: "payload_too_large",
      },
      413
    );
  }

  const syncSchema = transactionSchema.extend({
    id: z.string().min(1),
    createdAt: z.union([z.string(), z.number()]).optional(),
  });

  // Parse first, then resolve ownership for the whole batch in one query.
  // This previously ran a findUnique per row in a serial loop, so 1,000 rows
  // meant 1,000 sequential round-trips against the single SQLite connection,
  // blocking every other request for the duration.
  const parsed = transactions
    .map((raw) => syncSchema.safeParse(raw))
    .filter((r) => r.success)
    .map((r) => r.data);

  const owners = new Map(
    (
      await prisma.transaction.findMany({
        where: { id: { in: parsed.map((t) => t.id) } },
        select: { id: true, userId: true },
      })
    ).map((t) => [t.id, t.userId])
  );

  const validated = parsed
    .filter((tx) => {
      const owner = owners.get(tx.id);
      return owner === undefined || owner === user.id; // skip ownership violations
    })
    .map((tx) => ({ ...tx, _exists: owners.has(tx.id) }));

  // Execute all upserts atomically
  await prisma.$transaction(
    validated.map((tx) =>
      tx._exists
        ? prisma.transaction.update({
            where: { id: tx.id },
            data: {
              amount: tx.amount,
              category: tx.category,
              type: tx.type,
              isImpulse: tx.isImpulse,
              note: tx.note,
              dateISO: tx.dateISO,
            },
          })
        : prisma.transaction.create({
            data: {
              id: tx.id,
              userId: user.id,
              accountId: tx.accountId || null,
              amount: tx.amount,
              category: tx.category,
              type: tx.type,
              isImpulse: tx.isImpulse,
              note: tx.note || null,
              dateISO: tx.dateISO,
              currency: tx.currency,
              createdAt: new Date(tx.createdAt || Date.now()),
            },
          })
    )
  );

  return c.json({ synced: validated.length });
});

export { router as transactionsRouter };
