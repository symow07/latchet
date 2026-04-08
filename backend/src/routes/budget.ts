import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const budgetRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard
budgetRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// Helper: get business for current user (owner or member)
async function getUserBusiness(userId: string) {
  const owned = await prisma.business.findUnique({ where: { ownerId: userId } });
  if (owned) return owned;
  const membership = await prisma.teamMember.findFirst({
    where: { userId },
    include: { business: true },
  });
  return membership?.business ?? null;
}

// Helper: current month date range
function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

// ─── GET /api/business/budget ─────────────────────────────────────────────────
// Returns budget settings + current month spending breakdown
budgetRouter.get("/", async (c) => {
  const user = c.get("user")!;

  const business = await getUserBusiness(user.id);
  if (!business) return c.json({ error: "Not a member of any business" }, 403);

  const budget = await prisma.businessBudget.findUnique({
    where: { businessId: business.id },
  });

  const { start, end } = currentMonthRange();

  // Aggregate spending by category (approved + pending = "committed")
  const expenses = await prisma.expense.findMany({
    where: {
      businessId: business.id,
      status: { in: ["approved", "pending"] },
      submittedAt: { gte: start, lte: end },
    },
    select: { amount: true, category: true, status: true },
  });

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const approvedSpent = expenses
    .filter(e => e.status === "approved")
    .reduce((s, e) => s + e.amount, 0);

  const byCategory: Record<string, { spent: number; approved: number }> = {};
  for (const expense of expenses) {
    const cat = byCategory[expense.category] ?? { spent: 0, approved: 0 };
    cat.spent += expense.amount;
    if (expense.status === "approved") cat.approved += expense.amount;
    byCategory[expense.category] = cat;
  }

  const categoryBudgets: Record<string, number> = budget?.categories
    ? JSON.parse(budget.categories)
    : {};

  return c.json({
    budget: {
      totalMonthly: budget?.totalMonthly ?? 0,
      categories: categoryBudgets,
    },
    spending: {
      total: totalSpent,
      approved: approvedSpent,
      byCategory,
    },
    month: {
      year: start.getFullYear(),
      month: start.getMonth() + 1, // 1-based
      label: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
    },
  });
});

// ─── PUT /api/business/budget ─────────────────────────────────────────────────
// Set budget — only owner or manager
budgetRouter.put(
  "/",
  zValidator(
    "json",
    z.object({
      totalMonthly: z.number().min(0),
      categories: z.record(z.string(), z.number().min(0)).optional(),
    })
  ),
  async (c) => {
    const user = c.get("user")!;
    const { totalMonthly, categories } = c.req.valid("json");

    const business = await getUserBusiness(user.id);
    if (!business) return c.json({ error: "Not a member of any business" }, 403);

    // Check role
    const membership = await prisma.teamMember.findUnique({
      where: { businessId_userId: { businessId: business.id, userId: user.id } },
    });
    if (!membership || membership.role === "employee") {
      return c.json({ error: "Only owners and managers can set budgets" }, 403);
    }

    const budget = await prisma.businessBudget.upsert({
      where: { businessId: business.id },
      create: {
        businessId: business.id,
        totalMonthly,
        categories: categories ? JSON.stringify(categories) : null,
      },
      update: {
        totalMonthly,
        categories: categories ? JSON.stringify(categories) : undefined,
      },
    });

    let parsedCategories = {};
    if (budget.categories) {
      try {
        parsedCategories = JSON.parse(budget.categories);
      } catch (e) {
        console.error('Failed to parse budget categories:', e);
      }
    }
    return c.json({
      budget: {
        totalMonthly: budget.totalMonthly,
        categories: parsedCategories,
      },
    });
  }
);

export { budgetRouter };
