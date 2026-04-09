import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const TRANSACTION_CATEGORIES = [
  "Food", "Gym", "Transport", "Shopping", "Subscriptions",
  "Entertainment", "Health", "Education", "Bills", "Salary",
  "Investment", "Other",
] as const;

const transactionSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  category: z.enum(TRANSACTION_CATEGORIES),
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

  const syncSchema = transactionSchema.extend({
    id: z.string().min(1),
    createdAt: z.union([z.string(), z.number()]).optional(),
  });

  let synced = 0;
  for (const raw of transactions) {
    const parsed = syncSchema.safeParse(raw);
    if (!parsed.success) continue;
    const tx = parsed.data;

    // Validate ownership — never trust client-provided id
    const existing = await prisma.transaction.findUnique({ where: { id: tx.id } });

    if (existing && existing.userId !== user.id) {
      // Belongs to another user — skip
      continue;
    }

    if (existing) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          amount: tx.amount,
          category: tx.category,
          type: tx.type,
          isImpulse: tx.isImpulse,
          note: tx.note,
          dateISO: tx.dateISO,
        },
      });
    } else {
      await prisma.transaction.create({
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
      });
    }
    synced++;
  }

  return c.json({ synced });
});

export { router as transactionsRouter };
