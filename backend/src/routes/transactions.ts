import { Hono } from "hono";
import { prisma } from "../prisma";
import { auth } from "../auth";

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// GET all transactions for user
router.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const transactions = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { dateISO: "desc" },
  });
  return c.json(transactions);
});

// POST create transaction
router.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const transaction = await prisma.transaction.create({
    data: {
      id: body.id || `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      accountId: body.accountId || null,
      amount: body.amount,
      category: body.category,
      type: body.type,
      isImpulse: body.isImpulse || false,
      note: body.note || null,
      dateISO: body.dateISO,
      currency: body.currency || "USD",
    },
  });
  return c.json(transaction, 201);
});

// PUT update transaction
router.put("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json();

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
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.transaction.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

// POST bulk sync
router.post("/sync", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const { transactions } = body;

  if (!Array.isArray(transactions)) return c.json({ error: "Invalid payload" }, 400);

  interface TransactionInput {
    id: string;
    accountId?: string;
    amount: number;
    category: string;
    type: 'Expense' | 'Income';
    isImpulse?: boolean;
    note?: string;
    dateISO: string;
    currency?: string;
    createdAt?: string | number;
  }

  // Upsert all transactions
  const results = await Promise.all(
    (transactions as TransactionInput[]).map((tx) =>
      prisma.transaction.upsert({
        where: { id: tx.id },
        create: {
          id: tx.id,
          userId: user.id,
          accountId: tx.accountId || null,
          amount: tx.amount,
          category: tx.category,
          type: tx.type,
          isImpulse: tx.isImpulse || false,
          note: tx.note || null,
          dateISO: tx.dateISO,
          currency: tx.currency || "USD",
          createdAt: new Date(tx.createdAt || Date.now()),
        },
        update: {
          amount: tx.amount,
          category: tx.category,
          type: tx.type,
          isImpulse: tx.isImpulse,
          note: tx.note,
          dateISO: tx.dateISO,
        },
      })
    )
  );

  return c.json({ synced: results.length });
});

export { router as transactionsRouter };
