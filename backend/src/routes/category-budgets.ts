import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { categoryBudgetFields, storableText } from "../lib/sync/schemas";
import { stampTombstones } from "../lib/sync/sql";
import { newCategoryBudgetId } from "../lib/sync/push";
import { dbNow } from "../lib/distributed/clock";

/**
 * Category budgets, one per category per user. The phone syncs them through
 * /sync (Phase 4, entity `categoryBudgets`, keyed by category); these routes
 * write the same rows and follow the same model: every write stamps
 * clientUpdatedAt from the database clock (a server write wins over an older
 * phone copy, Phase 4 decision 4), and a delete leaves a tombstone, under the
 * category, carrying that time.
 */

// The field rules are shared with the sync rows (lib/sync/schemas.ts); the
// category is the sync id, 1–50 characters as for category names.
const categoryBudgetSchema = z.object({
  category: storableText(1, 50),
  amount: categoryBudgetFields.amount,
  period: categoryBudgetFields.period.optional().default("monthly"),
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

  // Explicit order: Postgres returns rows in no particular order (an updated
  // row can move), where the old single-file database happened to return them
  // in insertion order.
  const budgets = await prisma.categoryBudget.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return c.json(budgets);
});

router.post("/", zValidator("json", categoryBudgetSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");
  const now = await dbNow();
  const budget = await prisma.categoryBudget.upsert({
    where: { userId_category: { userId: user.id, category: body.category } },
    create: {
      id: newCategoryBudgetId(),
      userId: user.id,
      category: body.category,
      amount: body.amount,
      period: body.period,
      clientUpdatedAt: now,
    },
    update: {
      amount: body.amount,
      period: body.period,
      clientUpdatedAt: now,
    },
  });
  return c.json(budget);
});

// DELETE by the row's id (what GET returns); the tombstone is the category's.
router.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.categoryBudget.delete({ where: { id, userId: user.id } });
    // The tombstone the trigger wrote carries the row's last edit time; the
    // delete happened now, and a phone's older edit must not undo it.
    const now = (await dbNow(tx)).getTime();
    await stampTombstones(tx, user.id, "categoryBudgets", [{ id: deleted.category, cu: now }], { insertMissing: false });
  });
  return c.json({ success: true });
});

export { router as categoryBudgetsRouter };
