import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { getUserMembership } from "../lib/get-user-business";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  sniffImageType, contentTypeFor, receiptPath, receiptDir, isSafeId,
  MAX_RECEIPT_BASE64_CHARS,
} from "../lib/receipt-store";

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
// Delegates to the shared resolver so expenses cannot disagree with payroll and
// budget about which business the caller is acting in — this was its own
// unordered findFirst.
const getMembership = getUserMembership;

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
      // The receipt itself, base64. It used to be `imageUrl`, holding whatever
      // path the picker gave the submitter's phone — which rendered for them
      // and for nobody else, so a reviewer could not see what they approved.
      image: z.string().max(MAX_RECEIPT_BASE64_CHARS).optional().nullable(),
    })
  ),
  async (c) => {
    const user = c.get("user")!;
    const { amount, category, description, image } = c.req.valid("json");

    const membership = await getMembership(user.id);
    if (!membership) return c.json({ error: "Not a member of any business" }, 403);

    // Decoded and identified before the row is written, so an unreadable or
    // non-image upload fails the request outright instead of leaving an expense
    // pointing at a receipt that was never stored.
    let receipt: { bytes: Buffer; type: ReturnType<typeof sniffImageType> } | null = null;
    if (image) {
      const bytes = Buffer.from(image, "base64");
      const type = sniffImageType(bytes);
      if (!type) return c.json({ error: "Unsupported image format" }, 400);
      receipt = { bytes, type };
    }

    const expense = await prisma.expense.create({
      data: {
        businessId: membership.businessId,
        submitterId: user.id,
        amount,
        category,
        description,
        imageUrl: null,
        status: "pending",
      },
      include: {
        submitter: { select: { id: true, name: true, email: true } },
        reviewer:  { select: { id: true, name: true, email: true } },
      },
    });

    if (!receipt || !receipt.type) return c.json({ expense }, 201);

    // Named by the expense id, so the file and the row cannot disagree and a
    // resubmission cannot collide with someone else's receipt.
    try {
      const path = receiptPath(expense.id, receipt.type);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, receipt.bytes);
    } catch (e) {
      console.error("[expenses] receipt write failed:", e instanceof Error ? e.message : e);
      // The expense is real and worth keeping; only the image is missing, and
      // the row still says so because imageUrl was never set.
      return c.json({ expense }, 201);
    }

    // A path, not a URL: the client prefixes its own backend origin, so this
    // survives the backend moving without rewriting stored rows.
    const withReceipt = await prisma.expense.update({
      where: { id: expense.id },
      data: { imageUrl: `/api/expenses/${expense.id}/receipt` },
      include: {
        submitter: { select: { id: true, name: true, email: true } },
        reviewer:  { select: { id: true, name: true, email: true } },
      },
    });

    return c.json({ expense: withReceipt }, 201);
  }
);

// ─── GET /api/expenses/:id/receipt ────────────────────────────────────────────
// The receipt image, for anyone in the business that owns the expense.
//
// Scoped by the caller's own membership rather than by the id in the path: the
// id alone must never be enough, or a guessed cuid would hand a stranger
// somebody's receipt.
expensesRouter.get("/:id/receipt", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  if (!isSafeId(id)) return c.json({ error: "Not found" }, 404);

  const membership = await getMembership(user.id);
  if (!membership) return c.json({ error: "Not a member of any business" }, 403);

  const expense = await prisma.expense.findFirst({
    where: { id, businessId: membership.businessId },
    select: { id: true, imageUrl: true },
  });
  // Deliberately 404 rather than 403 for an expense in another business:
  // telling a caller that an id exists but is not theirs is itself a leak.
  if (!expense?.imageUrl) return c.json({ error: "Not found" }, 404);

  for (const type of ["jpg", "png", "webp", "heic"] as const) {
    try {
      const bytes = await readFile(receiptPath(id, type));
      return new Response(bytes, {
        headers: {
          "Content-Type": contentTypeFor(type),
          // Private: this is somebody's receipt, and a shared cache must not
          // hand it to the next person through the same proxy.
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch {
      // Wrong extension for this receipt; try the next.
    }
  }

  return c.json({ error: "Not found" }, 404);
});

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
