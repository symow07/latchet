import { Hono } from "hono";
import { prisma } from "../prisma";
import { auth } from "../auth";

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

router.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const accounts = await prisma.bankAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return c.json(accounts);
});

router.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

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
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

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
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.bankAccount.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

router.post("/sync", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

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

  const results = await Promise.all(
    (accounts as AccountInput[]).map((acc) =>
      prisma.bankAccount.upsert({
        where: { id: acc.id },
        create: {
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
        update: {
          name: acc.name,
          type: acc.type,
          balance: acc.balance,
          currency: acc.currency,
          color: acc.color,
          icon: acc.icon,
          isDefault: acc.isDefault,
        },
      })
    )
  );

  return c.json({ synced: results.length });
});

export { router as accountsRouter };
