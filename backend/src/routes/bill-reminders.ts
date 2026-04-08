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

  const reminders = await prisma.billReminder.findMany({
    where: { userId: user.id },
    orderBy: { nextDueDate: "asc" },
  });
  return c.json(reminders);
});

router.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const reminder = await prisma.billReminder.create({
    data: {
      id: `bill_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: body.name,
      amount: body.amount,
      dueDay: body.dueDay,
      category: body.category || "Other",
      isRecurring: body.isRecurring !== false,
      isPaid: false,
      nextDueDate: body.nextDueDate,
    },
  });
  return c.json(reminder, 201);
});

router.put("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json();

  const reminder = await prisma.billReminder.update({
    where: { id, userId: user.id },
    data: {
      name: body.name,
      amount: body.amount,
      dueDay: body.dueDay,
      category: body.category,
      isRecurring: body.isRecurring,
      isPaid: body.isPaid,
      paidAt: body.isPaid ? new Date() : null,
      nextDueDate: body.nextDueDate,
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
