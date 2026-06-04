import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

/**
 * Device push-token registry. The mobile app posts its Expo push token on
 * login; the bill-reminder job and badge alerts deliver pushes to these tokens.
 */

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

const tokenSchema = z.object({
  token: z.string().min(1).max(255),
  platform: z.string().max(16).optional(),
});

router.post("/", zValidator("json", tokenSchema), async (c) => {
  const user = c.get("user")!;
  const { token, platform } = c.req.valid("json");
  // Upsert by unique token; re-point it to the current user if the device was
  // previously signed in as someone else.
  const row = await prisma.pushToken.upsert({
    where: { token },
    create: { userId: user.id, token, platform },
    update: { userId: user.id, platform },
  });
  return c.json({ id: row.id });
});

router.delete("/", zValidator("json", z.object({ token: z.string().min(1) })), async (c) => {
  const user = c.get("user")!;
  const { token } = c.req.valid("json");
  await prisma.pushToken.deleteMany({ where: { token, userId: user.id } });
  return c.json({ success: true });
});

export { router as pushTokensRouter };
