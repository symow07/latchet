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

  const recurring = await prisma.recurringTransaction.findMany({
    where: { userId: user.id },
    orderBy: { nextDate: "asc" },
  });
  return c.json(recurring);
});

router.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const recurring = await prisma.recurringTransaction.create({
    data: {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      accountId: body.accountId || null,
      name: body.name,
      amount: body.amount,
      category: body.category,
      type: body.type,
      isImpulse: body.isImpulse || false,
      frequency: body.frequency,
      startDate: body.startDate,
      nextDate: body.nextDate,
      isActive: true,
      currency: body.currency || "USD",
    },
  });
  return c.json(recurring, 201);
});

router.put("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = await c.req.json();

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
