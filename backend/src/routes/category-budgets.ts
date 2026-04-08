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

  const budgets = await prisma.categoryBudget.findMany({
    where: { userId: user.id },
  });
  return c.json(budgets);
});

router.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const budget = await prisma.categoryBudget.upsert({
    where: { userId_category: { userId: user.id, category: body.category } },
    create: {
      id: `catbud_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      category: body.category,
      amount: body.amount,
      period: body.period || "monthly",
    },
    update: {
      amount: body.amount,
      period: body.period || "monthly",
    },
  });
  return c.json(budget);
});

router.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.categoryBudget.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

export { router as categoryBudgetsRouter };
