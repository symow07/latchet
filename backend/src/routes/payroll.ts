import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const payrollRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

payrollRouter.use("*", async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// Helper: find business for user (owner or member)
async function getUserBusiness(userId: string) {
  const owned = await prisma.business.findUnique({ where: { ownerId: userId } });
  if (owned) return owned;
  const m = await prisma.teamMember.findFirst({
    where: { userId },
    include: { business: true },
  });
  return m?.business ?? null;
}

// Helper: get or create payment record for month/year
async function ensurePayment(salaryId: string, month: number, year: number) {
  return prisma.salaryPayment.upsert({
    where: { salaryId_month_year: { salaryId, month, year } },
    create: { salaryId, month, year, status: "unpaid" },
    update: {},
  });
}

// ─── GET /api/payroll ─────────────────────────────────────────────────────────
// Returns all salaries + payment status for requested month/year
payrollRouter.get("/", async (c) => {
  const user = c.get("user")!;
  const now  = new Date();
  const month = Number(c.req.query("month") ?? now.getMonth() + 1);
  const year  = Number(c.req.query("year")  ?? now.getFullYear());

  const business = await getUserBusiness(user.id);
  if (!business) return c.json({ error: "Not a member of any business" }, 403);

  const salaries = await prisma.salary.findMany({
    where: { businessId: business.id },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      payments: { where: { month, year } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Ensure a payment row exists for every salary this month
  const result = await Promise.all(
    salaries.map(async (s) => {
      const payment = s.payments[0] ?? await ensurePayment(s.id, month, year);
      return {
        id: s.id,
        businessId: s.businessId,
        userId: s.userId,
        amount: s.amount,
        currency: s.currency,
        title: s.title,
        createdAt: s.createdAt,
        user: s.user,
        payment: {
          id: payment.id,
          month: payment.month,
          year: payment.year,
          status: payment.status,
          paidAt: payment.paidAt,
          note: payment.note,
        },
      };
    })
  );

  const totalPayroll = result.reduce((s, r) => s + r.amount, 0);
  const paidTotal    = result.filter(r => r.payment.status === "paid").reduce((s, r) => s + r.amount, 0);
  const unpaidTotal  = totalPayroll - paidTotal;

  return c.json({
    salaries: result,
    summary: { totalPayroll, paidTotal, unpaidTotal, month, year },
  });
});

// ─── POST /api/payroll ────────────────────────────────────────────────────────
// Upsert salary for a team member (owner/manager only)
payrollRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      userId: z.string().min(1),
      amount: z.number().min(0),
      title:  z.string().max(100).optional().nullable(),
      currency: z.string().length(3).default("USD").optional(),
    })
  ),
  async (c) => {
    const me = c.get("user")!;
    const { userId, amount, title, currency } = c.req.valid("json");

    const business = await getUserBusiness(me.id);
    if (!business) return c.json({ error: "Not a member of any business" }, 403);

    // Role check
    const myMembership = await prisma.teamMember.findUnique({
      where: { businessId_userId: { businessId: business.id, userId: me.id } },
    });
    if (!myMembership || myMembership.role === "employee") {
      return c.json({ error: "Only owners and managers can manage payroll" }, 403);
    }

    // Ensure target user is a team member
    const targetMember = await prisma.teamMember.findUnique({
      where: { businessId_userId: { businessId: business.id, userId } },
    });
    if (!targetMember) return c.json({ error: "User is not a member of this business" }, 404);

    const salary = await prisma.salary.upsert({
      where: { businessId_userId: { businessId: business.id, userId } },
      create: { businessId: business.id, userId, amount, title: title ?? null, currency: currency ?? "USD" },
      update: { amount, title: title ?? null, currency: currency ?? "USD" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return c.json({ salary }, 201);
  }
);

// ─── DELETE /api/payroll/:id ──────────────────────────────────────────────────
payrollRouter.delete("/:id", async (c) => {
  const me = c.get("user")!;
  const { id } = c.req.param();

  const business = await getUserBusiness(me.id);
  if (!business) return c.json({ error: "Not a member of any business" }, 403);

  const myMembership = await prisma.teamMember.findUnique({
    where: { businessId_userId: { businessId: business.id, userId: me.id } },
  });
  if (!myMembership || myMembership.role === "employee") {
    return c.json({ error: "Only owners and managers can manage payroll" }, 403);
  }

  const salary = await prisma.salary.findFirst({
    where: { id, businessId: business.id },
  });
  if (!salary) return c.json({ error: "Salary record not found" }, 404);

  await prisma.salary.delete({ where: { id } });
  return c.json({ success: true });
});

// ─── PATCH /api/payroll/:id/pay ───────────────────────────────────────────────
// Mark a payment as paid for a given month/year
payrollRouter.patch(
  "/:id/pay",
  zValidator(
    "json",
    z.object({
      month: z.number().int().min(1).max(12),
      year:  z.number().int().min(2020).max(2100),
      note:  z.string().max(300).optional().nullable(),
    })
  ),
  async (c) => {
    const me = c.get("user")!;
    const { id } = c.req.param();
    const { month, year, note } = c.req.valid("json");

    const business = await getUserBusiness(me.id);
    if (!business) return c.json({ error: "Not a member of any business" }, 403);

    const myMembership = await prisma.teamMember.findUnique({
      where: { businessId_userId: { businessId: business.id, userId: me.id } },
    });
    if (!myMembership || myMembership.role === "employee") {
      return c.json({ error: "Only owners and managers can mark payments" }, 403);
    }

    const salary = await prisma.salary.findFirst({
      where: { id, businessId: business.id },
    });
    if (!salary) return c.json({ error: "Salary record not found" }, 404);

    const payment = await prisma.salaryPayment.upsert({
      where: { salaryId_month_year: { salaryId: id, month, year } },
      create: { salaryId: id, month, year, status: "paid", paidAt: new Date(), note: note ?? null },
      update: { status: "paid", paidAt: new Date(), note: note ?? null },
    });

    return c.json({ payment });
  }
);

// ─── PATCH /api/payroll/:id/unpay ─────────────────────────────────────────────
payrollRouter.patch(
  "/:id/unpay",
  zValidator(
    "json",
    z.object({
      month: z.number().int().min(1).max(12),
      year:  z.number().int().min(2020).max(2100),
    })
  ),
  async (c) => {
    const me = c.get("user")!;
    const { id } = c.req.param();
    const { month, year } = c.req.valid("json");

    const business = await getUserBusiness(me.id);
    if (!business) return c.json({ error: "Not a member of any business" }, 403);

    const myMembership = await prisma.teamMember.findUnique({
      where: { businessId_userId: { businessId: business.id, userId: me.id } },
    });
    if (!myMembership || myMembership.role === "employee") {
      return c.json({ error: "Only owners and managers can mark payments" }, 403);
    }

    const salary = await prisma.salary.findFirst({
      where: { id, businessId: business.id },
    });
    if (!salary) return c.json({ error: "Salary record not found" }, 404);

    const payment = await prisma.salaryPayment.upsert({
      where: { salaryId_month_year: { salaryId: id, month, year } },
      create: { salaryId: id, month, year, status: "unpaid" },
      update: { status: "unpaid", paidAt: null, note: null },
    });

    return c.json({ payment });
  }
);

export { payrollRouter };
