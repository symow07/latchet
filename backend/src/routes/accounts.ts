import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { MAX_SYNC_ROWS } from "../lib/schemas";

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

router.put("/:id", zValidator("json", accountSchema.partial()), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const body = c.req.valid("json");

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
  if (accounts.length > MAX_SYNC_ROWS) {
    return c.json(
      {
        error: `Too many accounts in one request (max ${MAX_SYNC_ROWS})`,
        code: "payload_too_large",
      },
      413
    );
  }

  const syncSchema = accountSchema.extend({
    id: z.string().min(1),
    createdAt: z.union([z.string(), z.number()]).optional(),
  });

  // One batched ownership lookup instead of a findUnique per row in a serial
  // loop — see the note in transactions.ts/sync.
  const parsed = accounts
    .map((raw) => syncSchema.safeParse(raw))
    .filter((r) => r.success)
    .map((r) => r.data);

  const owners = new Map(
    (
      await prisma.bankAccount.findMany({
        where: { id: { in: parsed.map((a) => a.id) } },
        select: { id: true, userId: true },
      })
    ).map((a) => [a.id, a.userId])
  );

  const validated = parsed
    .filter((acc) => {
      const owner = owners.get(acc.id);
      return owner === undefined || owner === user.id;
    })
    .map((acc) => ({ ...acc, _exists: owners.has(acc.id) }));

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
