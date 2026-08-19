import { prisma } from "../prisma";

/**
 * Resolving which business a user is acting in.
 *
 * This used to be `prisma.teamMember.findFirst({ where: { userId } })` with no
 * ordering, which had two problems. The security one: combined with a
 * POST /api/business/team that accepted an arbitrary userId, a victim who
 * owned no business was silently resolved into whoever had added them, and
 * their business-mode screens then read and wrote that stranger's payroll and
 * expense data. The consent hole is closed at the route; this file closes the
 * other half by making the answer explicit and deterministic.
 */

export interface MembershipRow {
  businessId: string;
  createdAt: Date;
}

/**
 * Pick the business a user is acting in, given everything they belong to.
 *
 * Order of preference: their explicit selection (only if they really belong to
 * it), then a business they own, then their earliest membership. The final
 * tie-break is on id, so the result never depends on row order.
 */
export function selectActiveBusinessId(
  ownedBusinessId: string | null,
  memberships: MembershipRow[],
  activeBusinessId: string | null
): string | null {
  const reachable = new Set(memberships.map((m) => m.businessId));
  if (ownedBusinessId) reachable.add(ownedBusinessId);

  // An explicit choice is honoured only if the user actually belongs to it —
  // otherwise setting the field would itself grant access.
  if (activeBusinessId && reachable.has(activeBusinessId)) return activeBusinessId;

  if (ownedBusinessId) return ownedBusinessId;

  const earliest = [...memberships].sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    return byTime !== 0 ? byTime : a.businessId.localeCompare(b.businessId);
  })[0];

  return earliest?.businessId ?? null;
}

export async function getUserBusiness(userId: string) {
  const [owned, memberships, settings] = await Promise.all([
    prisma.business.findUnique({ where: { ownerId: userId } }),
    prisma.teamMember.findMany({
      where: { userId },
      select: { businessId: true, createdAt: true },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
      select: { activeBusinessId: true },
    }),
  ]);

  const businessId = selectActiveBusinessId(
    owned?.id ?? null,
    memberships,
    settings?.activeBusinessId ?? null
  );
  if (!businessId) return null;
  if (owned && businessId === owned.id) return owned;

  return prisma.business.findUnique({ where: { id: businessId } });
}

/** The caller's membership row in the business they are currently acting in. */
export async function getUserMembership(userId: string) {
  const business = await getUserBusiness(userId);
  if (!business) return null;

  const membership = await prisma.teamMember.findUnique({
    where: { businessId_userId: { businessId: business.id, userId } },
    include: { business: true },
  });
  if (membership) return membership;

  // The owner has full rights without a TeamMember row.
  if (business.ownerId === userId) {
    return {
      id: `owner_${business.id}`,
      businessId: business.id,
      userId,
      role: "owner" as const,
      createdAt: business.createdAt,
      updatedAt: business.updatedAt,
      business,
    };
  }
  return null;
}
