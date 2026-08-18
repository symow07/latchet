import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import {
  categoryName,
  isoDate,
  money,
  recurrenceFrequency,
  transactionType,
} from "../lib/schemas";

const recurringSchema = z.object({
  accountId: z.string().max(100).optional().nullable(),
  name: z.string().min(1).max(100),
  amount: money,
  category: categoryName,
  type: transactionType,
  isImpulse: z.boolean().optional().default(false),
  frequency: recurrenceFrequency,
  startDate: isoDate,
  nextDate: isoDate,
  currency: z.string().min(1).max(5).optional().default("USD"),
});

const recurringUpdateSchema = recurringSchema.partial().extend({
  lastCreated: isoDate.optional(),
  isActive: z.boolean().optional(),
});

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

router.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const recurring = await prisma.recurringTransaction.findMany({
    where: { userId: user.id },
    orderBy: { nextDate: "asc" },
  });
  return c.json(recurring);
});

router.post("/", zValidator("json", recurringSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");
  const recurring = await prisma.recurringTransaction.create({
    data: {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      accountId: body.accountId || null,
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
    },
  });
  return c.json(recurring, 201);
});

router.put("/:id", zValidator("json", recurringUpdateSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = c.req.valid("json");

  const recurring = await prisma.recurringTransaction.update({
    where: { id, userId: user.id },
    data: {
      name: body.name,
      amount: body.amount,
      category: body.category,
      type: body.type,
      frequency: body.frequency,
      nextDate: body.nextDate,
      lastCreated: body.lastCreated,
      isActive: body.isActive,
    },
  });
  return c.json(recurring);
});

router.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.recurringTransaction.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

export { router as recurringRouter };
