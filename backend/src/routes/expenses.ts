import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const expensesRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard
expensesRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// ─── Helper: get business membership for current user ─────────────────────────
async function getMembership(userId: string) {
  return prisma.teamMember.findFirst({
    where: { userId },
    include: { business: true },
  });
}

// ─── POST /api/expenses ───────────────────────────────────────────────────────
// Submit a new expense. Any team member can submit.
expensesRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      amount: z.number().positive(),
      category: z.enum(["Travel", "Software", "Meals", "Transport", "Office", "Other"]),
      description: z.string().min(1).max(500),
      imageUrl: z.string().optional().nullable(),
    })
  ),
  async (c) => {
    const user = c.get("user")!;
    const { amount, category, description, imageUrl } = c.req.valid("json");

    const membership = await getMembership(user.id);
    if (!membership) return c.json({ error: "Not a member of any business" }, 403);

    const expense = await prisma.expense.create({
      data: {
        businessId: membership.businessId,
        submitterId: user.id,
        amount,
        category,
        description,
        imageUrl: imageUrl ?? null,
        status: "pending",
      },
      include: {
        submitter: { select: { id: true, name: true, email: true } },
        reviewer:  { select: { id: true, name: true, email: true } },
      },
    });

    return c.json({ expense }, 201);
  }
);

// ─── GET /api/expenses ────────────────────────────────────────────────────────
// List all expenses in the business. Optional ?status= filter.
expensesRouter.get("/", async (c) => {
  const user = c.get("user")!;
  const status = c.req.query("status"); // pending|approved|rejected|undefined

  const membership = await getMembership(user.id);
  if (!membership) return c.json({ error: "Not a member of any business" }, 403);

  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 100);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const where = {
    businessId: membership.businessId,
    ...(status ? { status } : {}),
  };

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        submitter: { select: { id: true, name: true, email: true } },
        reviewer:  { select: { id: true, name: true, email: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.expense.count({ where }),
  ]);

  return c.json({ expenses, pagination: { limit, offset, total, hasMore: offset + limit < total } });
});

// ─── PATCH /api/expenses/:id/approve ─────────────────────────────────────────
// Approve a pending expense. Only owner or manager can approve.
expensesRouter.patch("/:id/approve", async (c) => {
  const user = c.get("user")!;
  const { id } = c.req.param();

  const membership = await getMembership(user.id);
  if (!membership) return c.json({ error: "Not a member of any business" }, 403);
  if (membership.role === "employee") return c.json({ error: "Insufficient permissions" }, 403);

  const expense = await prisma.expense.findFirst({
    where: { id, businessId: membership.businessId },
  });
  if (!expense) return c.json({ error: "Expense not found" }, 404);
  if (expense.status !== "pending") return c.json({ error: "Expense is not pending" }, 400);
  if (expense.submitterId === user.id) return c.json({ error: "Cannot approve your own expense" }, 403);

  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "approved", reviewerId: user.id, reviewedAt: new Date() },
    include: {
      submitter: { select: { id: true, name: true, email: true } },
      reviewer:  { select: { id: true, name: true, email: true } },
    },
  });

  return c.json({ expense: updated });
});

// ─── PATCH /api/expenses/:id/reject ──────────────────────────────────────────
// Reject a pending expense. Only owner or manager can reject.
expensesRouter.patch("/:id/reject", async (c) => {
  const user = c.get("user")!;
  const { id } = c.req.param();

  const membership = await getMembership(user.id);
  if (!membership) return c.json({ error: "Not a member of any business" }, 403);
  if (membership.role === "employee") return c.json({ error: "Insufficient permissions" }, 403);

  const expense = await prisma.expense.findFirst({
    where: { id, businessId: membership.businessId },
  });
  if (!expense) return c.json({ error: "Expense not found" }, 404);
  if (expense.status !== "pending") return c.json({ error: "Expense is not pending" }, 400);
  if (expense.submitterId === user.id) return c.json({ error: "Cannot reject your own expense" }, 403);

  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "rejected", reviewerId: user.id, reviewedAt: new Date() },
    include: {
      submitter: { select: { id: true, name: true, email: true } },
      reviewer:  { select: { id: true, name: true, email: true } },
    },
  });

  return c.json({ expense: updated });
});

export { expensesRouter };
