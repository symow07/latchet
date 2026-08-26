import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { buildBusinessProfileFields } from "../lib/business-profile";
import { auth } from "../auth";
import { randomBytes } from "crypto";
import { getUserBusiness } from "../lib/get-user-business";

const businessRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Auth guard
businessRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase(); // 6 char hex
}

// Simple rate limiter for invite code attempts
const joinAttempts = new Map<string, { count: number; resetAt: number }>();
const JOIN_MAX = 5;
const JOIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkJoinRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = joinAttempts.get(userId);
  if (!entry || now > entry.resetAt) {
    joinAttempts.set(userId, { count: 1, resetAt: now + JOIN_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= JOIN_MAX;
}

// ─── createBusiness ───────────────────────────────────────────────────────────
// POST /api/business
businessRouter.post(
  "/",
  zValidator("json", z.object({ name: z.string().min(1).max(200).optional() })),
  async (c) => {
    const user = c.get("user")!;
    const { name } = c.req.valid("json");

    const existing = await prisma.business.findUnique({
      where: { ownerId: user.id },
      include: { teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (existing) return c.json({ business: existing }, 200);

    const business = await prisma.business.create({
      data: {
        ownerId: user.id,
        name: name?.trim() || `${user.name}'s Business`,
        inviteCode: generateCode(),
        teamMembers: { create: { userId: user.id, role: "owner" } },
      },
      include: { teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });

    return c.json({ business }, 201);
  }
);

// ─── getBusiness ──────────────────────────────────────────────────────────────
// GET /api/business — returns the business the current user is acting in
businessRouter.get("/", async (c) => {
  const user = c.get("user")!;

  // Resolve through the shared selector rather than a second findFirst.
  // Two independent resolutions meant a user in more than one business could
  // be shown business A while payroll and expense writes — which go through
  // getUserBusiness — landed in business B.
  const business = await getUserBusiness(user.id);
  if (!business) return c.json({ error: "No business found" }, 404);

  const full = await prisma.business.findUnique({
    where: { id: business.id },
    include: {
      teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  return c.json({ business: full });
});

// ─── updateBusiness ───────────────────────────────────────────────────────────
// PATCH /api/business — company profile and tax identity.
//
// Scoped by ownerId, not by membership. A manager can approve expenses; only
// the owner changes the company's legal identity, and findUnique on ownerId
// means a non-owner cannot reach another business's row even by guessing ids.
businessRouter.patch(
  "/",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(200).optional(),
      // Empty string clears the field. Distinguishing "not sent" from "cleared"
      // is why these are nullable rather than just optional: undefined leaves a
      // value alone, null and "" remove it.
      address: z.string().max(500).nullish(),
      vatNumber: z.string().max(64).nullish(),
      taxId: z.string().max(64).nullish(),
      fiscalYearStartMonth: z.number().int().min(1).max(12).nullish(),
    })
  ),
  async (c) => {
    const user = c.get("user")!;
    const patch = c.req.valid("json");

    const business = await prisma.business.findUnique({ where: { ownerId: user.id } });
    if (!business) return c.json({ error: "No business found" }, 404);

    const updated = await prisma.business.update({
      where: { id: business.id },
      data: buildBusinessProfileFields(patch),
      include: { teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });

    return c.json({ business: updated });
  }
);

// ─── getInviteCode ────────────────────────────────────────────────────────────
// GET /api/business/invite-code — owner regenerates/gets invite code
businessRouter.get("/invite-code", async (c) => {
  const user = c.get("user")!;

  const business = await prisma.business.findUnique({ where: { ownerId: user.id } });
  if (!business) return c.json({ error: "No business found" }, 404);

  // Generate code if missing
  if (!business.inviteCode) {
    const updated = await prisma.business.update({
      where: { id: business.id },
      data: { inviteCode: generateCode() },
    });
    return c.json({ code: updated.inviteCode, businessName: business.name });
  }

  return c.json({ code: business.inviteCode, businessName: business.name });
});

// ─── refreshInviteCode ────────────────────────────────────────────────────────
// POST /api/business/invite-code/refresh
businessRouter.post("/invite-code/refresh", async (c) => {
  const user = c.get("user")!;

  const business = await prisma.business.findUnique({ where: { ownerId: user.id } });
  if (!business) return c.json({ error: "No business found" }, 404);

  let code = generateCode();
  // Ensure uniqueness
  for (let i = 0; i < 10; i++) {
    const tryCode = generateCode();
    const exists = await prisma.business.findUnique({ where: { inviteCode: tryCode } });
    if (!exists) {
      code = tryCode;
      break;
    }
  }

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: { inviteCode: code },
  });

  return c.json({ code: updated.inviteCode, businessName: business.name });
});

// ─── joinBusiness ─────────────────────────────────────────────────────────────
// POST /api/business/join — employee joins with an invite code
businessRouter.post(
  "/join",
  zValidator("json", z.object({ code: z.string().min(1).max(20) })),
  async (c) => {
    const user = c.get("user")!;
    const { code } = c.req.valid("json");

    if (!checkJoinRateLimit(user.id)) {
      return c.json({ error: "Too many join attempts, try again later" }, 429);
    }

    const business = await prisma.business.findUnique({
      where: { inviteCode: code.toUpperCase() },
    });
    if (!business) return c.json({ error: "Invalid invite code" }, 404);

    // Check if already a member
    const existing = await prisma.teamMember.findUnique({
      where: { businessId_userId: { businessId: business.id, userId: user.id } },
    });
    if (existing) return c.json({ error: "Already a member of this business" }, 409);

    // Can't join your own business (already owner)
    if (business.ownerId === user.id) {
      return c.json({ error: "You own this business" }, 409);
    }

    const member = await prisma.teamMember.create({
      data: { businessId: business.id, userId: user.id, role: "employee" },
    });

    return c.json({ member, businessName: business.name }, 201);
  }
);

// ─── getMembers ───────────────────────────────────────────────────────────────
// GET /api/business/members — list all members with user details
businessRouter.get("/members", async (c) => {
  const user = c.get("user")!;

  // Same shared selector as everything else. The old findFirst also missed
  // owners entirely — an owner has no TeamMember row, so listing their own
  // team answered 403.
  const business = await getUserBusiness(user.id);
  if (!business) return c.json({ error: "Not a member of any business" }, 403);

  const members = await prisma.teamMember.findMany({
    where: { businessId: business.id },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });

  return c.json({ members });
});

// ─── addTeamMember: removed ───────────────────────────────────────────────────
// POST /api/business/team used to accept an arbitrary userId and create a
// TeamMember row for it — no invitation, no consent, no check that the user
// even existed. Because membership then resolved by findFirst, a victim who
// owned no business was silently resolved into the attacker's business, and
// their business-mode screens read and wrote that attacker's payroll and
// expense data.
//
// There is no safe version of "add this stranger to my company", so the route
// is gone. Joining happens one way: the invitee enters the owner's invite code
// at POST /api/business/join, which is consent by construction and already
// rate-limited. Role changes for existing members remain at
// PATCH /api/business/team/:memberId.

// ─── setActiveBusiness ────────────────────────────────────────────────────────
// PUT /api/business/active — choose which business to act in.
businessRouter.put(
  "/active",
  zValidator("json", z.object({ businessId: z.string().min(1) })),
  async (c) => {
    const user = c.get("user")!;
    const { businessId } = c.req.valid("json");

    // Selecting a business must never be what grants access to it.
    const owned = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id },
    });
    const membership = owned
      ? null
      : await prisma.teamMember.findUnique({
          where: { businessId_userId: { businessId, userId: user.id } },
        });
    if (!owned && !membership) {
      return c.json({ error: "You are not a member of that business" }, 403);
    }

    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { activeBusinessId: businessId },
    });

    return c.json({ activeBusinessId: businessId });
  }
);

// ─── updateMemberRole ─────────────────────────────────────────────────────────
// PATCH /api/business/team/:memberId
businessRouter.patch(
  "/team/:memberId",
  zValidator("json", z.object({ role: z.enum(["manager", "employee"]) })),
  async (c) => {
    const user = c.get("user")!;
    const { memberId } = c.req.param();
    const { role } = c.req.valid("json");

    const business = await prisma.business.findUnique({ where: { ownerId: user.id } });
    if (!business) return c.json({ error: "No business found" }, 404);

    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, businessId: business.id },
    });
    if (!member) return c.json({ error: "Member not found" }, 404);
    if (member.userId === user.id) return c.json({ error: "Cannot change own role" }, 400);

    const updated = await prisma.teamMember.update({
      where: { id: memberId },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return c.json({ member: updated });
  }
);

// ─── removeMember ─────────────────────────────────────────────────────────────
// DELETE /api/business/team/:memberId
businessRouter.delete("/team/:memberId", async (c) => {
  const user = c.get("user")!;
  const { memberId } = c.req.param();

  const business = await prisma.business.findUnique({ where: { ownerId: user.id } });
  if (!business) return c.json({ error: "No business found" }, 404);

  const member = await prisma.teamMember.findFirst({
    where: { id: memberId, businessId: business.id },
  });
  if (!member) return c.json({ error: "Member not found" }, 404);
  if (member.userId === user.id) return c.json({ error: "Cannot remove yourself" }, 400);

  await prisma.teamMember.delete({ where: { id: memberId } });

  return c.json({ success: true });
});

export { businessRouter };
