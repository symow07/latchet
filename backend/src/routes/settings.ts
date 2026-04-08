import { Hono } from "hono";
import { prisma } from "../prisma";
import { auth } from "../auth";

const router = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

router.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });
  return c.json(settings);
});

router.put("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      id: `settings_${user.id}`,
      userId: user.id,
      monthlyBudget: body.monthlyBudget || 0,
      startingBalance: body.startingBalance || 0,
      hourlyValue: body.hourlyValue || 0,
      showTimeCost: body.showTimeCost || false,
      currency: body.currency || "USD",
      currencySymbol: body.currencySymbol || "$",
      monthlyIncome: body.monthlyIncome || 0,
      savingsGoal: body.savingsGoal || 0,
      spendingStyle: body.spendingStyle || "moderate",
      primaryGoal: body.primaryGoal || "track",
    },
    update: {
      monthlyBudget: body.monthlyBudget,
      startingBalance: body.startingBalance,
      hourlyValue: body.hourlyValue,
      showTimeCost: body.showTimeCost,
      currency: body.currency,
      currencySymbol: body.currencySymbol,
      monthlyIncome: body.monthlyIncome,
      savingsGoal: body.savingsGoal,
      spendingStyle: body.spendingStyle,
      primaryGoal: body.primaryGoal,
    },
  });
  return c.json(settings);
});

export { router as settingsRouter };
