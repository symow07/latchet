import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { randomBytes } from "crypto";

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
// GET /api/business — returns business the current user is a member of (owner OR team)
businessRouter.get("/", async (c) => {
  const user = c.get("user")!;

  // First check if they own a business
  const owned = await prisma.business.findUnique({
    where: { ownerId: user.id },
    include: { teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  if (owned) return c.json({ business: owned });

  // Otherwise check if they are a team member
  const membership = await prisma.teamMember.findFirst({
    where: { userId: user.id },
    include: {
      business: {
        include: { teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } } },
      },
    },
  });
  if (!membership) return c.json({ error: "No business found" }, 404);

  return c.json({ business: membership.business });
});

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

  // Find the business the user belongs to
  const membership = await prisma.teamMember.findFirst({
    where: { userId: user.id },
    include: { business: true },
  });
  if (!membership) return c.json({ error: "Not a member of any business" }, 403);

  const members = await prisma.teamMember.findMany({
    where: { businessId: membership.businessId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });

  return c.json({ members });
});

// ─── addTeamMember ────────────────────────────────────────────────────────────
// POST /api/business/team
businessRouter.post(
  "/team",
  zValidator("json", z.object({ userId: z.string().min(1), role: z.enum(["manager", "employee"]) })),
  async (c) => {
    const user = c.get("user")!;
    const { userId, role } = c.req.valid("json");

    const business = await prisma.business.findUnique({ where: { ownerId: user.id } });
    if (!business) return c.json({ error: "No business found" }, 404);

    const existing = await prisma.teamMember.findUnique({
      where: { businessId_userId: { businessId: business.id, userId } },
    });
    if (existing) return c.json({ member: existing }, 200);

    const member = await prisma.teamMember.create({
      data: { businessId: business.id, userId, role },
    });

    return c.json({ member }, 201);
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
