import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { breakdownInput, netWorthFields } from "../lib/sync/schemas";
import { dbNow } from "../lib/distributed/clock";

/**
 * Net-worth snapshots. The phone syncs them through /sync (Phase 4, entity
 * `netWorth`); a snapshot written here stamps clientUpdatedAt from the
 * database clock like every server write (Phase 4 decision 4), and reaches
 * the phone on its next pull.
 */

// The field rules are shared with the sync rows (lib/sync/schemas.ts); the
// breakdown is an object here and stored as its JSON text, which is what the
// sync wire carries, under the same 10,000-character cap a push applies.
const netWorthSchema = z.object({
  date: netWorthFields.date,
  // Required, not optional: `body.assets - body.liabilities` on a missing field
  // produced NaN and stored it permanently.
  assets: netWorthFields.assets,
  liabilities: netWorthFields.liabilities,
  breakdown: breakdownInput.optional(),
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

  const entries = await prisma.netWorthEntry.findMany({
    where: { userId: user.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: 24,
  });
  return c.json(entries);
});

router.post("/", zValidator("json", netWorthSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");
  const entry = await prisma.netWorthEntry.create({
    data: {
      id: `nw_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      date: body.date,
      assets: body.assets,
      liabilities: body.liabilities,
      netWorth: body.assets - body.liabilities,
      breakdown: body.breakdown ? JSON.stringify(body.breakdown) : null,
      clientUpdatedAt: await dbNow(),
    },
  });
  return c.json(entry, 201);
});

export { router as netWorthRouter };
