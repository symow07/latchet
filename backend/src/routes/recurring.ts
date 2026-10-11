import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import {
  categoryName,
  isoDate,
  money,
  recurrenceFrequency,
  transactionType,
} from "../lib/schemas";
import { runRecurringNow } from "../jobs/recurring-booking";

const recurringSchema = z.object({
  accountId: z.string().max(100).optional().nullable(),
  name: z.string().min(1).max(100),
  amount: money,
  category: categoryName,
  type: transactionType,
  isImpulse: z.boolean().optional().default(false),
  frequency: recurrenceFrequency,
  startDate: isoDate,
  nextDate: isoDate,
  currency: z.string().min(1).max(5).optional().default("USD"),
});

const recurringUpdateSchema = recurringSchema.partial().extend({
  lastCreated: isoDate.optional(),
  isActive: z.boolean().optional(),
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

  const recurring = await prisma.recurringTransaction.findMany({
    where: { userId: user.id },
    orderBy: { nextDate: "asc" },
  });
  return c.json(recurring);
});

router.post("/", zValidator("json", recurringSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");
  const recurring = await prisma.recurringTransaction.create({
    data: {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      accountId: body.accountId || null,
      name: body.name,
      amount: body.amount,
      category: body.category,
      type: body.type,
      isImpulse: body.isImpulse,
      frequency: body.frequency,
      startDate: body.startDate,
      nextDate: body.nextDate,
      isActive: true,
      currency: body.currency,
    },
  });
  return c.json(recurring, 201);
});

router.put("/:id", zValidator("json", recurringUpdateSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = c.req.valid("json");

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

// ─── run now ──────────────────────────────────────────────────────────────────
// POST /recurring/:id/run — book today's occurrence now, owner only.
//
// Replaces what the app used to do itself: post a transaction and then set
// nextDate to today, after which the job booked a second one. This books
// through the job's own code (jobs/recurring-booking.ts) under the job's own
// occurrence id, tx_rec_<id>_<YYYY-MM-DD> (UTC), so the two can never both
// book a day, on one instance or several. The booked row reaches the phone
// through sync like any server-created transaction.
//
// 201 { transactionId, nextDate } when this call booked it; 200 with the same
// id when today's occurrence was already booked. A series that is not the
// caller's is 404, the same as one that does not exist.
router.post("/:id/run", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const result = await runRecurringNow(c.req.param("id"), user.id);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json({ transactionId: result.transactionId, nextDate: result.nextDate }, result.status);
});

router.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.recurringTransaction.delete({ where: { id, userId: user.id } });
  return c.json({ success: true });
});

export { router as recurringRouter };
