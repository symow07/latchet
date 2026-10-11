import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../auth";
import { MAX_SYNC_ROWS, PULL_PAGE_DEFAULT, SYNC_ENTITIES } from "../lib/sync/constants";
import { applyPush } from "../lib/sync/push";
import { InvalidCursorError, pullPage } from "../lib/sync/pull";

/**
 * Two-way sync with the phone (PLAN.md I-WIRE), mounted at /api/v1/sync and
 * /api/sync.
 *
 *   POST /push  a device's changed and deleted rows, last writer wins
 *   GET  /pull  everything that changed after a cursor, or a snapshot
 *
 * The rules live in lib/sync: schemas.ts (rows), conflict.ts (who wins),
 * cursor.ts (order, cursor and safety lag), push.ts and pull.ts (the SQL).
 */
const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

router.use("*", async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

/**
 * The envelope only. Rows are validated one by one in push.ts, so one bad row
 * is reported `invalid` instead of failing the other 999.
 */
const pushBody = z.object({
  changes: z.object(
    Object.fromEntries(SYNC_ENTITIES.map((e) => [e, z.array(z.unknown()).optional()])) as Record<
      (typeof SYNC_ENTITIES)[number],
      z.ZodOptional<z.ZodArray<z.ZodUnknown>>
    >
  ),
});

router.post(
  "/push",
  // 1,000 full rows are well under a megabyte; this only stops a body that
  // is not a sync push from being parsed at all.
  bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json({ error: "Request body too large", code: "payload_too_large" }, 413),
  }),
  zValidator("json", pushBody),
  async (c) => {
    const user = c.get("user")!;
    const { changes } = c.req.valid("json");
    const total = SYNC_ENTITIES.reduce((n, e) => n + (changes[e]?.length ?? 0), 0);
    if (total > MAX_SYNC_ROWS) {
      return c.json(
        { error: `Too many rows in one push (max ${MAX_SYNC_ROWS})`, code: "payload_too_large", max: MAX_SYNC_ROWS },
        413
      );
    }
    return c.json(await applyPush(user.id, changes));
  }
);

const pullQuery = z.object({
  cursor: z.string().max(1024).optional(),
  limit: z
    .string()
    .regex(/^\d{1,4}$/, "limit must be a whole number from 1 to 1000")
    .transform(Number)
    .refine((n) => n >= 1 && n <= 1000, "limit must be a whole number from 1 to 1000")
    .optional(),
});

router.get("/pull", zValidator("query", pullQuery), async (c) => {
  const user = c.get("user")!;
  const { cursor, limit } = c.req.valid("query");
  try {
    return c.json(await pullPage(user.id, cursor, limit ?? PULL_PAGE_DEFAULT));
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return c.json({ error: "Invalid sync cursor; pull again without one", code: "invalid_cursor" }, 400);
    }
    throw err;
  }
});

export { router as syncRouter };
