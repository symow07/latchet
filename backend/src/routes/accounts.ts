import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const accountSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  type: z.enum(["cash", "checking", "savings", "credit", "investment", "other"]),
  balance: z.number().optional().default(0),
  currency: z.string().min(1).max(5).optional().default("USD"),
  color: z.string().optional().default("#a855f7"),
  icon: z.string().optional().default("wallet"),
  isDefault: z.boolean().optional().default(false),
});

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

router.post("/", zValidator("json", accountSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");
  const account = await prisma.bankAccount.create({
    data: {
      id: body.id || `acc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: body.name,
      type: body.type,
      balance: body.balance,
      currency: body.currency,
      color: body.color,
      icon: body.icon,
      isDefault: body.isDefault,
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

  // Pre-validate ownership for all accounts
  const validated: Array<AccountInput & { _exists: boolean }> = [];
  for (const acc of accounts as AccountInput[]) {
    if (!acc.id || !acc.name || !acc.type) continue;
    const existing = await prisma.bankAccount.findUnique({ where: { id: acc.id } });
    if (existing && existing.userId !== user.id) continue;
    validated.push({ ...acc, _exists: !!existing });
  }

  // Execute all upserts atomically
  await prisma.$transaction(
    validated.map((acc) =>
      acc._exists
        ? prisma.bankAccount.update({
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
          })
        : prisma.bankAccount.create({
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
          })
    )
  );

  return c.json({ synced: validated.length });
});

export { router as accountsRouter };
