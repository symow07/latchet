import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

/**
 * Persisted gamification. The mobile app computes which badges are currently
 * unlocked (getUnlockedBadges) and the current logging streak, then POSTs them
 * here. We persist any badge the user has never earned before (preserving the
 * original earnedAt) and keep a high-water mark of their best streak. The
 * `newlyEarned` list lets the client fire a "badge earned" notification.
 */

// Streak high-water mark is stored in a reserved Achievement row so we don't
// need a separate table; it is filtered out of the user-facing list.
const STREAK_BADGE = "__best_streak__";

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

async function bestStreakFor(userId: string): Promise<number> {
  const row = await prisma.achievement.findUnique({
    where: { userId_badge: { userId, badge: STREAK_BADGE } },
  });
  return row?.bestStreak ?? 0;
}

router.get("/", async (c) => {
  const user = c.get("user")!;
  const [achievements, bestStreak] = await Promise.all([
    prisma.achievement.findMany({
      where: { userId: user.id, NOT: { badge: STREAK_BADGE } },
      orderBy: { earnedAt: "asc" },
    }),
    bestStreakFor(user.id),
  ]);
  return c.json({ achievements, bestStreak });
});

const syncSchema = z.object({
  badges: z.array(z.string().min(1).max(64)).max(50),
  streak: z.number().int().min(0).max(100000).optional().default(0),
});

router.post("/sync", zValidator("json", syncSchema), async (c) => {
  const user = c.get("user")!;
  const { badges, streak } = c.req.valid("json");

  const existing = await prisma.achievement.findMany({
    where: { userId: user.id },
    select: { badge: true },
  });
  const known = new Set(existing.map((a) => a.badge));
  const newlyEarned = badges.filter((b) => b !== STREAK_BADGE && !known.has(b));

  // Persist newly-earned badges (create-only keeps the first earnedAt).
  await Promise.all(
    newlyEarned.map((badge) =>
      prisma.achievement.create({
        data: { userId: user.id, badge },
      })
    )
  );

  // Update the streak high-water mark.
  const prevBest = await bestStreakFor(user.id);
  if (streak > prevBest) {
    await prisma.achievement.upsert({
      where: { userId_badge: { userId: user.id, badge: STREAK_BADGE } },
      create: { userId: user.id, badge: STREAK_BADGE, bestStreak: streak },
      update: { bestStreak: streak },
    });
  }

  const [achievements, bestStreak] = await Promise.all([
    prisma.achievement.findMany({
      where: { userId: user.id, NOT: { badge: STREAK_BADGE } },
      orderBy: { earnedAt: "asc" },
    }),
    bestStreakFor(user.id),
  ]);

  return c.json({ achievements, bestStreak, newlyEarned });
});

export { router as achievementsRouter };
