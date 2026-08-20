import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const settingsSchema = z.object({
  monthlyBudget: z.number().min(0).max(10_000_000).optional().default(0),
  startingBalance: z.number().min(-10_000_000).max(10_000_000).optional().default(0),
  hourlyValue: z.number().min(0).max(100_000).optional().default(0),
  showTimeCost: z.boolean().optional().default(false),
  currency: z.string().min(1).max(5).optional().default("USD"),
  currencySymbol: z.string().min(1).max(5).optional().default("$"),
  monthlyIncome: z.number().min(0).max(10_000_000).optional().default(0),
  savingsGoal: z.number().min(0).max(10_000_000).optional().default(0),
  spendingStyle: z.enum(["frugal", "moderate", "generous"]).optional().default("moderate"),
  // Must match the options onboarding actually offers (mobile/src/app/onboarding.tsx).
  // The backend previously accepted "invest"/"debt", so two of the four goals a
  // user could tap were rejected with a 400 the moment settings synced.
  primaryGoal: z
    .enum(["save", "track", "reduce_debt", "budget"])
    .optional()
    .default("track"),
  // Must match SUPPORTED_LOCALES in mobile/src/lib/i18n/core.ts.
  locale: z.enum(["en", "fr", "zh"]).optional().default("en"),
});

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard
router.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

router.get("/", async (c) => {
  const user = c.get("user")!;
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });
  return c.json(settings);
});

router.put("/", zValidator("json", settingsSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      id: `settings_${user.id}`,
      userId: user.id,
      ...body,
    },
    update: body,
  });
  return c.json(settings);
});

export { router as settingsRouter };
