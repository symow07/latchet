import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { billReminderFields } from "../lib/sync/schemas";
import { stampTombstones } from "../lib/sync/sql";
import { dbNow } from "../lib/distributed/clock";
import { rearmsNotifier } from "../jobs/bill-reminder-checker";

/**
 * Bill reminders. The phone syncs them through /sync (Phase 4, entity
 * `billReminders`); these routes write the same rows and follow the same
 * model: every write stamps clientUpdatedAt from the database clock (a server
 * write wins over an older phone copy, Phase 4 decision 4), and a delete
 * leaves a tombstone carrying that time. lastNotifiedAt is the notifier's own
 * and is re-armed only by moving the bill to a later due date.
 */

// The field rules are shared with the sync rows (lib/sync/schemas.ts).
const billReminderSchema = z.object({
  name: billReminderFields.name,
  amount: billReminderFields.amount,
  dueDay: billReminderFields.dueDay,
  category: billReminderFields.category.optional().default("Other"),
  isRecurring: billReminderFields.isRecurring.optional().default(true),
  nextDueDate: billReminderFields.nextDueDate,
});

// Every field optional, none defaulted: a field left out keeps its value.
const billReminderUpdateSchema = z.object({
  name: billReminderFields.name.optional(),
  amount: billReminderFields.amount.optional(),
  dueDay: billReminderFields.dueDay.optional(),
  category: billReminderFields.category.optional(),
  isRecurring: billReminderFields.isRecurring.optional(),
  isPaid: billReminderFields.isPaid.optional(),
  nextDueDate: billReminderFields.nextDueDate.optional(),
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

  const reminders = await prisma.billReminder.findMany({
    where: { userId: user.id },
    orderBy: [{ nextDueDate: "asc" }, { id: "asc" }],
  });
  return c.json(reminders);
});

router.post("/", zValidator("json", billReminderSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");
  const reminder = await prisma.billReminder.create({
    data: {
      id: `bill_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      name: body.name,
      amount: body.amount,
      dueDay: body.dueDay,
      category: body.category,
      isRecurring: body.isRecurring,
      isPaid: false,
      nextDueDate: body.nextDueDate,
      clientUpdatedAt: await dbNow(),
    },
  });
  return c.json(reminder, 201);
});

router.put("/:id", zValidator("json", billReminderUpdateSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const body = c.req.valid("json");

  const reminder = await prisma.$transaction(async (tx) => {
    const [stored] = await tx.$queryRaw<{ nextDueDate: string }[]>`
      SELECT "nextDueDate" FROM "BillReminder" WHERE "id" = ${id} AND "userId" = ${user.id} FOR UPDATE`;
    if (!stored) return null;
    const now = await dbNow(tx);
    return tx.billReminder.update({
      where: { id, userId: user.id },
      data: {
        name: body.name,
        amount: body.amount,
        dueDay: body.dueDay,
        category: body.category,
        isRecurring: body.isRecurring,
        isPaid: body.isPaid,
        // Only touch paidAt when isPaid is actually part of this request;
        // otherwise an unrelated edit silently cleared the payment timestamp.
        ...(body.isPaid !== undefined ? { paidAt: body.isPaid ? now : null } : {}),
        nextDueDate: body.nextDueDate,
        // Re-arm the notifier when the bill moves to a later due date — and
        // only then: the app sends the date back on every save, and marking
        // a bill unpaid again must not fire its due date a second time.
        ...(rearmsNotifier(stored.nextDueDate, body.nextDueDate) ? { lastNotifiedAt: null } : {}),
        clientUpdatedAt: now,
      },
    });
  });
  if (!reminder) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(reminder);
});

router.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  await prisma.$transaction(async (tx) => {
    await tx.billReminder.delete({ where: { id, userId: user.id } });
    // The tombstone the trigger wrote carries the row's last edit time; the
    // delete happened now, and a phone's older edit must not undo it.
    const now = (await dbNow(tx)).getTime();
    await stampTombstones(tx, user.id, "billReminders", [{ id, cu: now }], { insertMissing: false });
  });
  return c.json({ success: true });
});

export { router as billRemindersRouter };
