import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { settingsFields } from "../lib/sync/schemas";

// The field rules are shared with the sync rows (lib/sync/schemas.ts); only
// the defaults for a field left out are this route's own.
const settingsSchema = z.object({
  monthlyBudget: settingsFields.monthlyBudget.optional().default(0),
  startingBalance: settingsFields.startingBalance.optional().default(0),
  hourlyValue: settingsFields.hourlyValue.optional().default(0),
  showTimeCost: settingsFields.showTimeCost.optional().default(false),
  currency: settingsFields.currency.optional().default("USD"),
  currencySymbol: settingsFields.currencySymbol.optional().default("$"),
  monthlyIncome: settingsFields.monthlyIncome.optional().default(0),
  savingsGoal: settingsFields.savingsGoal.optional().default(0),
  spendingStyle: settingsFields.spendingStyle.optional().default("moderate"),
  // Must match the options onboarding actually offers (mobile/src/app/onboarding.tsx).
  // The backend previously accepted "invest"/"debt", so two of the four goals a
  // user could tap were rejected with a 400 the moment settings synced.
  primaryGoal: settingsFields.primaryGoal.optional().default("track"),
  // Must match SUPPORTED_LOCALES in mobile/src/lib/i18n/core.ts, and
  // locale-parity.test.ts fails if it does not. "ar" was missing for a while
  // after Arabic shipped, which did not merely reset the locale — zValidator
  // rejects the whole body, so an Arabic user's ENTIRE settings sync 400'd.
  // Exactly what the primaryGoal comment above describes, repeated.
  // Spelled out here because locale-parity.test.ts reads this line; the sync
  // rows use LOCALES in lib/sync/schemas.ts, and its test checks the two agree.
  locale: z.enum(["en", "fr", "zh", "ar"]).optional().default("en"),
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
      clientUpdatedAt: new Date(),
    },
    // Stamped like any other write, so a device's older copy cannot win it back.
    update: { ...body, clientUpdatedAt: new Date() },
  });
  return c.json(settings);
});

export { router as settingsRouter };
