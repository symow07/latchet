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

  const entries = await prisma.netWorthEntry.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 24,
  });
  return c.json(entries);
});

router.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const entry = await prisma.netWorthEntry.create({
    data: {
      id: `nw_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      date: body.date,
      assets: body.assets,
      liabilities: body.liabilities,
      netWorth: body.assets - body.liabilities,
      breakdown: body.breakdown ? JSON.stringify(body.breakdown) : null,
    },
  });
  return c.json(entry, 201);
});

export { router as netWorthRouter };
