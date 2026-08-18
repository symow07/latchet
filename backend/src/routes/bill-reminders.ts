import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { categoryName, isoDate, money } from "../lib/schemas";

const billReminderSchema = z.object({
  name: z.string().min(1).max(100),
  amount: money,
  dueDay: z.number().int().min(1).max(31),
  category: categoryName.optional().default("Other"),
  isRecurring: z.boolean().optional().default(true),
  nextDueDate: isoDate,
});

// Every field optional on update, but each still validated when present.
const billReminderUpdateSchema = billReminderSchema.partial().extend({
  isPaid: z.boolean().optional(),
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

  const reminders = await prisma.billReminder.findMany({
    where: { userId: user.id },
    orderBy: { nextDueDate: "asc" },
  });
  return c.json(reminders);
});

router.post("/", zValidator("json", billReminderSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");
  const reminder = await prisma.billReminder.create({
    data: {
      id: `bill_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: body.name,
      amount: body.amount,
      dueDay: body.dueDay,
      category: body.category,
      isRecurring: body.isRecurring,
      isPaid: false,
      nextDueDate: body.nextDueDate,
    },
  });
  return c.json(reminder, 201);
});

router.put("/:id", zValidator("json", billReminderUpdateSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = c.req.valid("json");

  const reminder = await prisma.billReminder.update({
    where: { id, userId: user.id },
    data: {
      name: body.name,
      amount: body.amount,
      dueDay: body.dueDay,
      category: body.category,
      isRecurring: body.isRecurring,
      isPaid: body.isPaid,
      // Only touch paidAt when isPaid is actually part of this request;
      // otherwise an unrelated edit silently cleared the payment timestamp.
      ...(body.isPaid !== undefined ? { paidAt: body.isPaid ? new Date() : null } : {}),
      nextDueDate: body.nextDueDate,
      // Re-arm the notifier when a bill is moved to a new due date.
      ...(body.nextDueDate !== undefined ? { lastNotifiedAt: null } : {}),
    },
  });
  return c.json(reminder);
});

router.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.billReminder.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

export { router as billRemindersRouter };
