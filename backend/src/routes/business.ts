import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { buildBusinessProfileFields } from "../lib/business-profile";
import {
  receiptPath, logoPath, sniffImageType, contentTypeFor, LOGO_KIND, MAX_RECEIPT_BASE64_CHARS,
} from "../lib/receipt-store";
import { rm, writeFile, readFile } from "../lib/distributed/files";
import { auth } from "../auth";
import { randomBytes } from "crypto";
import { getUserBusiness } from "../lib/get-user-group";
import { makeJoinRateLimiter } from "../lib/group-invites";

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

// Invite-code attempts, five per user per quarter hour across every instance
// (lib/group-invites.ts). Its own budget, separate from the household one.
const checkJoinRateLimit = makeJoinRateLimiter("business");

// ─── createBusiness ───────────────────────────────────────────────────────────
// POST /api/business
businessRouter.post(
  "/",
  zValidator("json", z.object({ name: z.string().min(1).max(200).optional() })),
  async (c) => {
    const user = c.get("user")!;
    const { name } = c.req.valid("json");

    const existing = await prisma.group.findUnique({
      where: { ownerId_type: { ownerId: user.id, type: "business" } },
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (existing) return c.json({ business: existing }, 200);

    const business = await prisma.group.create({
      data: {
        ownerId: user.id,
        name: name?.trim() || `${user.name}'s Business`,
        inviteCode: generateCode(),
        members: { create: { userId: user.id, role: "owner" } },
      },
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
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

  const full = await prisma.group.findUnique({
    where: { id: business.id },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
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

    const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
    if (!business) return c.json({ error: "No business found" }, 404);

    const updated = await prisma.group.update({
      where: { id: business.id },
      data: buildBusinessProfileFields(patch),
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });

    return c.json({ business: updated });
  }
);

// ─── deleteBusiness ───────────────────────────────────────────────────────────
// DELETE /api/business — remove the company and everything hanging off it.
//
// Owner only, and gated on retyping the company name. The cascade takes every
// expense, salary and budget with it, so an accidental tap here is not
// recoverable from inside the app — the UI asks too, but an endpoint that
// deletes a company on an empty body is one stray request from a catastrophe.
businessRouter.delete(
  "/",
  zValidator("json", z.object({ confirmName: z.string().min(1) })),
  async (c) => {
    const user = c.get("user")!;
    const { confirmName } = c.req.valid("json");

    const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
    if (!business) return c.json({ error: "No business found" }, 404);

    if (confirmName.trim() !== business.name.trim()) {
      return c.json({ error: "Name does not match" }, 400);
    }

    // The company, its logo and every receipt filed under it go in one
    // transaction: either all of it is gone or none of it is. Receipts are
    // stored under the business's folder, so one recursive rm takes them all
    // without listing the expenses first. (A receipt whose upload commits in
    // the instant between the two is swept later by the retention job, which
    // removes any receipt or logo whose expense or business no longer exists.)
    await prisma.$transaction(async (tx) => {
      await tx.group.delete({ where: { id: business.id } });
      await rm(receiptPath(business.id), { recursive: true }, tx);
      await rm(logoPath(business.id), {}, tx);
    });

    return c.json({ ok: true });
  }
);

// ─── logo ─────────────────────────────────────────────────────────────────────
// PUT /api/business/logo — replace the company logo. Owner only.
// GET /api/business/logo — anyone in the business can see it.
//
// The bytes are stored in Postgres beside receipts (lib/distributed/files) and
// served back from here, by whichever instance gets the request. logoUrl
// holds this path and never a remote URL: a stored address would be fetched
// by every client that renders the company, handing whoever set it a view of
// every viewer.
businessRouter.put(
  "/logo",
  zValidator("json", z.object({ image: z.string().max(MAX_RECEIPT_BASE64_CHARS) })),
  async (c) => {
    const user = c.get("user")!;
    const { image } = c.req.valid("json");

    const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
    if (!business) return c.json({ error: "No business found" }, 404);

    // Identified from the bytes, never from a client-supplied name: that value
    // decides the content type every viewer is served.
    const bytes = Buffer.from(image, "base64");
    const type = sniffImageType(bytes);
    if (!type) return c.json({ error: "Unsupported image format" }, 400);

    // One path per business whatever the format, so a replacement simply
    // overwrites the old logo; the file and logoUrl commit together.
    const updated = await prisma.$transaction(
      async (tx) => {
        await writeFile(
          logoPath(business.id),
          bytes,
          { kind: LOGO_KIND, ownerId: business.id, contentType: contentTypeFor(type) },
          tx
        );
        return tx.group.update({
          where: { id: business.id },
          data: { logoUrl: "/api/business/logo" },
          include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
        });
      },
      // Up to 10 MB of bytes in one statement.
      { timeout: 30_000 }
    );

    return c.json({ business: updated });
  }
);

businessRouter.delete("/logo", async (c) => {
  const user = c.get("user")!;
  const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
  if (!business) return c.json({ error: "No business found" }, 404);

  const updated = await prisma.$transaction(async (tx) => {
    await rm(logoPath(business.id), {}, tx);
    return tx.group.update({
      where: { id: business.id },
      data: { logoUrl: null },
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
  });
  return c.json({ business: updated });
});

businessRouter.get("/logo", async (c) => {
  const user = c.get("user")!;

  // Scoped by the caller's own membership: a logo belongs to a company, and
  // the id is never taken from the request.
  const membership = await getUserBusiness(user.id);
  if (!membership) return c.json({ error: "Not found" }, 404);

  const file = await readFile(logoPath(membership.id));
  if (!file) return c.json({ error: "Not found" }, 404);
  return new Response(file.bytes, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=86400",
    },
  });
});

// ─── getInviteCode ────────────────────────────────────────────────────────────
// GET /api/business/invite-code — owner regenerates/gets invite code
businessRouter.get("/invite-code", async (c) => {
  const user = c.get("user")!;

  const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
  if (!business) return c.json({ error: "No business found" }, 404);

  // Generate code if missing
  if (!business.inviteCode) {
    const updated = await prisma.group.update({
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

  const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
  if (!business) return c.json({ error: "No business found" }, 404);

  let code = generateCode();
  // Ensure uniqueness
  for (let i = 0; i < 10; i++) {
    const tryCode = generateCode();
    const exists = await prisma.group.findUnique({ where: { inviteCode: tryCode } });
    if (!exists) {
      code = tryCode;
      break;
    }
  }

  const updated = await prisma.group.update({
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

    if (!(await checkJoinRateLimit(user.id))) {
      return c.json({ error: "Too many join attempts, try again later" }, 429);
    }

    // Scoped to type. Invite codes are unique across ALL groups now that
    // households share the table, so an unscoped lookup would let a household
    // code join someone to this business endpoint — and land them in a group
    // whose role vocabulary and visibility rules are not the ones they were
    // shown. Same 404 either way: a wrong-type code must not be distinguishable
    // from a nonexistent one, or the endpoint reports which codes are real.
    const business = await prisma.group.findFirst({
      where: { inviteCode: code.toUpperCase(), type: "business" },
    });
    if (!business) return c.json({ error: "Invalid invite code" }, 404);

    // Check if already a member
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: business.id, userId: user.id } },
    });
    if (existing) return c.json({ error: "Already a member of this business" }, 409);

    // Can't join your own business (already owner)
    if (business.ownerId === user.id) {
      return c.json({ error: "You own this business" }, 409);
    }

    const member = await prisma.groupMember.create({
      data: { groupId: business.id, userId: user.id, role: "employee" },
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

  const members = await prisma.groupMember.findMany({
    where: { groupId: business.id },
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
  zValidator("json", z.object({ groupId: z.string().min(1) })),
  async (c) => {
    const user = c.get("user")!;
    const { groupId } = c.req.valid("json");

    // Selecting a business must never be what grants access to it.
    const owned = await prisma.group.findFirst({
      where: { id: groupId, ownerId: user.id },
    });
    const membership = owned
      ? null
      : await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: user.id } },
        });
    if (!owned && !membership) {
      return c.json({ error: "You are not a member of that business" }, 403);
    }

    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { activeGroupId: groupId },
    });

    return c.json({ activeGroupId: groupId });
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

    const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
    if (!business) return c.json({ error: "No business found" }, 404);

    const member = await prisma.groupMember.findFirst({
      where: { id: memberId, groupId: business.id },
    });
    if (!member) return c.json({ error: "Member not found" }, 404);
    if (member.userId === user.id) return c.json({ error: "Cannot change own role" }, 400);

    const updated = await prisma.groupMember.update({
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

  const business = await prisma.group.findUnique({ where: { ownerId_type: { ownerId: user.id, type: "business" } } });
  if (!business) return c.json({ error: "No business found" }, 404);

  const member = await prisma.groupMember.findFirst({
    where: { id: memberId, groupId: business.id },
  });
  if (!member) return c.json({ error: "Member not found" }, 404);
  if (member.userId === user.id) return c.json({ error: "Cannot remove yourself" }, 400);

  await prisma.groupMember.delete({ where: { id: memberId } });

  return c.json({ success: true });
});

export { businessRouter };
