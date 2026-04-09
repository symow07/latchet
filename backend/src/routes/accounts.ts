import { Hono } from "hono";
import { prisma } from "../prisma";
import { auth } from "../auth";

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard for all account routes
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

router.get("/", async (c) => {
  const user = c.get("user")!;
  const accounts = await prisma.bankAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return c.json(accounts);
});

router.post("/", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json();
  const account = await prisma.bankAccount.create({
    data: {
      id: body.id || `acc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: body.name,
      type: body.type,
      balance: body.balance || 0,
      currency: body.currency || "USD",
      color: body.color || "#a855f7",
      icon: body.icon || "wallet",
      isDefault: body.isDefault || false,
    },
  });
  return c.json(account, 201);
});

router.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const account = await prisma.bankAccount.update({
    where: { id, userId: user.id },
    data: {
      name: body.name,
      type: body.type,
      balance: body.balance,
      currency: body.currency,
      color: body.color,
      icon: body.icon,
      isDefault: body.isDefault,
    },
  });
  return c.json(account);
});

router.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  await prisma.bankAccount.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

router.post("/sync", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json();
  const { accounts } = body;

  if (!Array.isArray(accounts)) return c.json({ error: "Invalid payload" }, 400);

  interface AccountInput {
    id: string;
    name: string;
    type: string;
    balance?: number;
    currency?: string;
    color?: string;
    icon?: string;
    isDefault?: boolean;
    createdAt?: string | number;
  }

  let synced = 0;
  for (const acc of accounts as AccountInput[]) {
    // Validate ownership before upsert — never trust client-provided id
    const existing = await prisma.bankAccount.findUnique({ where: { id: acc.id } });

    if (existing && existing.userId !== user.id) {
      // Record belongs to another user — skip silently
      continue;
    }

    if (existing) {
      await prisma.bankAccount.update({
        where: { id: acc.id },
        data: {
          name: acc.name,
          type: acc.type,
          balance: acc.balance,
          currency: acc.currency,
          color: acc.color,
          icon: acc.icon,
          isDefault: acc.isDefault,
        },
      });
    } else {
      await prisma.bankAccount.create({
        data: {
          id: acc.id,
          userId: user.id,
          name: acc.name,
          type: acc.type,
          balance: acc.balance || 0,
          currency: acc.currency || "USD",
          color: acc.color || "#a855f7",
          icon: acc.icon || "wallet",
          isDefault: acc.isDefault || false,
          createdAt: new Date(acc.createdAt || Date.now()),
        },
      });
    }
    synced++;
  }

  return c.json({ synced });
});

export { router as accountsRouter };
