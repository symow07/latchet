import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { generateInviteCode, makeJoinRateLimiter } from "../lib/group-invites";
import { sendPushToUser } from "../lib/expo-push";
import { getUserGroup, getUserGroupMembership } from "../lib/get-user-group";
import {
  projectMember,
  projectSharedAccountTransactions,
  normalizeShareLevel,
  SHARE_LEVELS,
  type MemberFinances,
  type MemberTransaction,
} from "../lib/share-level";

/**
 * Household sharing.
 *
 * The same Group table as business mode, with type "household" and a two-role
 * vocabulary. What differs is not the shape but the consent model: an employee
 * submits an expense deliberately, whereas a household member's ordinary
 * spending is aggregated automatically. That is why shareLevel exists here and
 * is irrelevant to business expense flows — it governs the automatic half.
 *
 * Everything on this router is built so that nobody can learn more about a
 * member than that member chose to reveal, including the owner. See
 * lib/share-level.ts.
 */

const householdRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

householdRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

const checkJoinRateLimit = makeJoinRateLimiter();

const HOUSEHOLD_ROLES = ["owner", "member"] as const;

/**
 * Plain-language wording for the notification body.
 *
 * Deliberately not the raw level name: "full" tells a recipient nothing about
 * what changed for them. Not localised, because the server does not know the
 * recipient's locale — UserSettings.locale is per user and this is sent to
 * several at once. A follow-up would look it up per recipient.
 */
const VISIBILITY_WORDING: Record<string, string> = {
  summary: "totals only",
  categories: "totals and spending by category",
  full: "totals, categories and individual transactions",
};

/** The group summary every screen needs, with no member finances in it. */
function publicGroup(g: { id: string; name: string; type: string; ownerId: string }) {
  return { id: g.id, name: g.name, type: g.type, ownerId: g.ownerId };
}

// ─── create ──────────────────────────────────────────────────────────────────
// POST /api/v1/household
householdRouter.post(
  "/",
  zValidator("json", z.object({ name: z.string().min(1).max(200) })),
  async (c) => {
    const user = c.get("user")!;
    const { name } = c.req.valid("json");

    const existing = await prisma.group.findUnique({
      where: { ownerId_type: { ownerId: user.id, type: "household" } },
    });
    if (existing) return c.json({ error: "You already own a household" }, 409);

    const group = await prisma.group.create({
      data: {
        ownerId: user.id,
        name,
        type: "household",
        inviteCode: generateInviteCode(),
        // The creator is a member like anyone else, and starts at the floor.
        // Owning the household does not mean broadcasting your own finances.
        members: { create: { userId: user.id, role: "owner", shareLevel: "summary" } },
      },
      include: { members: true },
    });

    return c.json({ household: publicGroup(group), inviteCode: group.inviteCode }, 201);
  }
);

// ─── read ────────────────────────────────────────────────────────────────────
// GET /api/v1/household
householdRouter.get("/", async (c) => {
  const user = c.get("user")!;
  const group = await getUserGroup(user.id, "household");
  if (!group) return c.json({ household: null });

  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return c.json({
    household: publicGroup(group),
    isOwner: group.ownerId === user.id,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      role: m.role,
      shareLevel: normalizeShareLevel(m.shareLevel),
      joinedAt: m.createdAt,
    })),
  });
});

// ─── invite preview — the consent screen ─────────────────────────────────────
// GET /api/v1/household/preview?code=ABC123
//
// Deliberately readable BEFORE joining, and deliberately says what joining
// costs. A join screen that only names the household is not informed consent.
householdRouter.get("/preview", async (c) => {
  const user = c.get("user")!;
  const code = (c.req.query("code") ?? "").toUpperCase();
  if (!code) return c.json({ error: "Missing code" }, 400);

  // Rate limited on the same budget as joining: without this, preview becomes
  // the oracle that tells an attacker which codes exist.
  if (!checkJoinRateLimit(user.id)) {
    return c.json({ error: "Too many attempts, try again later" }, 429);
  }

  const group = await prisma.group.findFirst({
    where: { inviteCode: code, type: "household" },
    include: { members: { include: { user: { select: { name: true } } } } },
  });
  if (!group) return c.json({ error: "Invalid invite code" }, 404);

  return c.json({
    name: group.name,
    memberCount: group.members.length,
    memberNames: group.members.map((m) => m.user.name),
    // Exactly what will happen, in the response, so the client cannot show a
    // friendlier version of it than the server intends.
    joiningMeans: {
      defaultShareLevel: "summary",
      sharedOnJoin: ["totalIn", "totalOut"],
      notSharedOnJoin: ["categories", "transactions", "accountBalances"],
      changeableAnyTime: true,
      leaveableAnyTime: true,
    },
  });
});

// ─── join ────────────────────────────────────────────────────────────────────
// POST /api/v1/household/join
householdRouter.post(
  "/join",
  zValidator(
    "json",
    z.object({
      code: z.string().min(1).max(20),
      // The client must state what it showed the user. A join that did not go
      // through the consent screen has nothing to send here.
      acknowledgedShareLevel: z.enum(SHARE_LEVELS),
    })
  ),
  async (c) => {
    const user = c.get("user")!;
    const { code, acknowledgedShareLevel } = c.req.valid("json");

    if (!checkJoinRateLimit(user.id)) {
      return c.json({ error: "Too many join attempts, try again later" }, 429);
    }

    const group = await prisma.group.findFirst({
      where: { inviteCode: code.toUpperCase(), type: "household" },
    });
    if (!group) return c.json({ error: "Invalid invite code" }, 404);

    if (group.ownerId === user.id) {
      return c.json({ error: "You own this household" }, 409);
    }
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
    });
    if (existing) return c.json({ error: "Already a member of this household" }, 409);

    const member = await prisma.groupMember.create({
      data: {
        groupId: group.id,
        userId: user.id,
        role: "member",
        // The acknowledged level is a floor-check, not a setting: joining can
        // never start someone above summary, whatever the client claims it
        // displayed.
        shareLevel: "summary",
      },
    });

    return c.json(
      {
        household: publicGroup(group),
        member: { userId: member.userId, role: member.role, shareLevel: member.shareLevel },
        acknowledged: acknowledgedShareLevel,
      },
      201
    );
  }
);

// ─── my own visibility ───────────────────────────────────────────────────────
// PATCH /api/v1/household/my-share-level
householdRouter.patch(
  "/my-share-level",
  zValidator("json", z.object({ shareLevel: z.enum(SHARE_LEVELS) })),
  async (c) => {
    const user = c.get("user")!;
    const { shareLevel } = c.req.valid("json");

    const membership = await getUserGroupMembership(user.id, "household");
    if (!membership) return c.json({ error: "Not in a household" }, 404);

    const previous = normalizeShareLevel(membership.shareLevel);
    const updated = await prisma.groupMember.update({
      where: { groupId_userId: { groupId: membership.groupId, userId: user.id } },
      data: { shareLevel },
    });

    // Raising your own visibility is announced; lowering it is not. Silent
    // reduction is nobody's business. A silent INCREASE is how covert tracking
    // gets built by accident — someone talked into raising it, with no trace
    // that the group now sees more.
    const raised = SHARE_LEVELS.indexOf(shareLevel) > SHARE_LEVELS.indexOf(previous);

    if (raised) {
      // Sent from the SERVER, not requested by the client. A notification the
      // app chooses to send is one a modified app can decline to send, and the
      // whole point is that the group finds out even when the person raising
      // it would rather they did not.
      const others = await prisma.groupMember.findMany({
        where: { groupId: membership.groupId, userId: { not: user.id } },
        select: { userId: true },
      });
      const name = user.name || user.email;
      await Promise.all(
        others.map((m) =>
          sendPushToUser(
            m.userId,
            "Household visibility changed",
            `${name} now shares ${VISIBILITY_WORDING[shareLevel]} with the household.`,
            { type: "household-visibility", groupId: membership.groupId }
          )
        )
      );
    }

    return c.json({
      shareLevel: updated.shareLevel,
      previous,
      notifyGroup: raised,
    });
  }
);

// ─── who can see what ────────────────────────────────────────────────────────
// GET /api/v1/household/visibility
//
// The panel that must never be buried in settings: for every member, what they
// currently reveal. Symmetric by construction — the query does not take a
// viewer, so nobody sees a different version of it.
householdRouter.get("/visibility", async (c) => {
  const user = c.get("user")!;
  const group = await getUserGroup(user.id, "household");
  if (!group) return c.json({ error: "Not in a household" }, 404);

  const [members, sharedAccounts] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.bankAccount.findMany({
      where: { sharedWithGroupId: group.id },
      select: { id: true, name: true, userId: true },
    }),
  ]);

  return c.json({
    householdName: group.name,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      role: m.role,
      shareLevel: normalizeShareLevel(m.shareLevel),
      isYou: m.userId === user.id,
      sharedAccounts: sharedAccounts
        .filter((a) => a.userId === m.userId)
        .map((a) => ({ id: a.id, name: a.name })),
    })),
  });
});

// ─── the dashboard ───────────────────────────────────────────────────────────
// GET /api/v1/household/dashboard?month=YYYY-MM
householdRouter.get("/dashboard", async (c) => {
  const user = c.get("user")!;
  const group = await getUserGroup(user.id, "household");
  if (!group) return c.json({ error: "Not in a household" }, 404);

  const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "Invalid month" }, 400);

  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const sharedAccounts = await prisma.bankAccount.findMany({
    where: { sharedWithGroupId: group.id },
    select: { id: true, name: true, userId: true, balance: true, currency: true },
  });
  const sharedAccountIds = new Set(sharedAccounts.map((a) => a.id));

  const projected = [];
  const sharedTransactions: MemberTransaction[] = [];

  for (const m of members) {
    const rows = await prisma.transaction.findMany({
      where: { userId: m.userId, dateISO: { startsWith: month } },
      select: {
        id: true, accountId: true, amount: true, type: true,
        category: true, note: true, dateISO: true,
      },
    });

    const finances: MemberFinances = {
      userId: m.userId,
      name: m.user.name,
      totalIn: rows.filter((r) => r.type === "Income").reduce((s, r) => s + r.amount, 0),
      totalOut: rows.filter((r) => r.type !== "Income").reduce((s, r) => s + r.amount, 0),
      byCategory: rows
        .filter((r) => r.type !== "Income")
        .reduce<Record<string, number>>((acc, r) => {
          acc[r.category] = (acc[r.category] ?? 0) + r.amount;
          return acc;
        }, {}),
      transactions: rows,
    };

    // The projection happens HERE, before anything is assembled into a
    // response body. Nothing downstream re-reads `rows`.
    projected.push(projectMember(finances, m.shareLevel));
    sharedTransactions.push(...projectSharedAccountTransactions(rows, sharedAccountIds));
  }

  return c.json({
    householdName: group.name,
    month,
    combined: {
      totalIn: projected.reduce((s, p) => s + p.totalIn, 0),
      totalOut: projected.reduce((s, p) => s + p.totalOut, 0),
    },
    members: projected,
    sharedAccounts: sharedAccounts.map((a) => ({
      id: a.id, name: a.name, balance: a.balance, currency: a.currency, ownerId: a.userId,
    })),
    sharedTransactions: sharedTransactions.sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
  });
});

// ─── invite code ─────────────────────────────────────────────────────────────
householdRouter.get("/invite-code", async (c) => {
  const user = c.get("user")!;
  const group = await prisma.group.findUnique({
    where: { ownerId_type: { ownerId: user.id, type: "household" } },
  });
  if (!group) return c.json({ error: "No household found" }, 404);

  if (!group.inviteCode) {
    const updated = await prisma.group.update({
      where: { id: group.id },
      data: { inviteCode: generateInviteCode() },
    });
    return c.json({ code: updated.inviteCode, householdName: group.name });
  }
  return c.json({ code: group.inviteCode, householdName: group.name });
});

householdRouter.post("/invite-code/refresh", async (c) => {
  const user = c.get("user")!;
  const group = await prisma.group.findUnique({
    where: { ownerId_type: { ownerId: user.id, type: "household" } },
  });
  if (!group) return c.json({ error: "No household found" }, 404);

  const updated = await prisma.group.update({
    where: { id: group.id },
    data: { inviteCode: generateInviteCode() },
  });
  return c.json({ code: updated.inviteCode });
});

// ─── leaving ─────────────────────────────────────────────────────────────────
// DELETE /api/v1/household/leave
//
// Unilateral and immediate. No owner approval, no grace period, no
// notification gate: a member who wants out is out on the round trip. Leaving
// also un-shares every account they had opted in, because an account shared
// with a household you are no longer in is a hole nobody would think to check.
householdRouter.delete("/leave", async (c) => {
  const user = c.get("user")!;
  const group = await getUserGroup(user.id, "household");
  if (!group) return c.json({ error: "Not in a household" }, 404);

  if (group.ownerId === user.id) {
    return c.json(
      { error: "The owner cannot leave; delete the household instead" },
      409
    );
  }

  await prisma.$transaction([
    prisma.bankAccount.updateMany({
      where: { userId: user.id, sharedWithGroupId: group.id },
      data: { sharedWithGroupId: null },
    }),
    prisma.groupMember.deleteMany({ where: { groupId: group.id, userId: user.id } }),
  ]);

  return c.json({ ok: true });
});

// ─── deleting the household ──────────────────────────────────────────────────
householdRouter.delete(
  "/",
  zValidator("json", z.object({ confirmName: z.string().min(1) })),
  async (c) => {
    const user = c.get("user")!;
    const { confirmName } = c.req.valid("json");

    const group = await prisma.group.findUnique({
      where: { ownerId_type: { ownerId: user.id, type: "household" } },
    });
    if (!group) return c.json({ error: "No household found" }, 404);
    if (confirmName.trim() !== group.name.trim()) {
      return c.json({ error: "Name does not match" }, 400);
    }

    // Un-share first: the FK is SET NULL, but doing it explicitly means the
    // accounts are detached even if the group delete is rolled back.
    await prisma.$transaction([
      prisma.bankAccount.updateMany({
        where: { sharedWithGroupId: group.id },
        data: { sharedWithGroupId: null },
      }),
      prisma.group.delete({ where: { id: group.id } }),
    ]);

    return c.json({ ok: true });
  }
);

export { householdRouter, HOUSEHOLD_ROLES };
