import { prisma } from "../prisma";

/**
 * Resolving which group a user is acting in.
 *
 * This used to be `prisma.teamMember.findFirst({ where: { userId } })` with no
 * ordering, which had two problems. The security one: combined with a
 * POST /api/business/team that accepted an arbitrary userId, a victim who
 * owned no business was silently resolved into whoever had added them, and
 * their business-mode screens then read and wrote that stranger's payroll and
 * expense data. The consent hole is closed at the route; this file closes the
 * other half by making the answer explicit and deterministic.
 *
 * Everything here is now scoped by group TYPE. A user may own a business and
 * belong to a household at the same time, and the two must never resolve into
 * one another — asking for the household must not return the company because
 * the company happened to sort first.
 */

export type GroupType = "business" | "household";

export interface MembershipRow {
  groupId: string;
  createdAt: Date;
}

/**
 * Pick the group a user is acting in, given everything they belong to.
 *
 * Order of preference: their explicit selection (only if they really belong to
 * it), then a group they own, then their earliest membership. The final
 * tie-break is on id, so the result never depends on row order.
 *
 * Callers must pass only memberships of a single type; this function cannot
 * see types and will happily return whatever it is given.
 */
export function selectActiveGroupId(
  ownedGroupId: string | null,
  memberships: MembershipRow[],
  activeGroupId: string | null
): string | null {
  const reachable = new Set(memberships.map((m) => m.groupId));
  if (ownedGroupId) reachable.add(ownedGroupId);

  // An explicit choice is honoured only if the user actually belongs to it —
  // otherwise setting the field would itself grant access.
  if (activeGroupId && reachable.has(activeGroupId)) return activeGroupId;

  if (ownedGroupId) return ownedGroupId;

  const earliest = [...memberships].sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    return byTime !== 0 ? byTime : a.groupId.localeCompare(b.groupId);
  })[0];

  return earliest?.groupId ?? null;
}

export async function getUserGroup(userId: string, type: GroupType) {
  const [owned, memberships, settings] = await Promise.all([
    prisma.group.findUnique({ where: { ownerId_type: { ownerId: userId, type } } }),
    // Scoped to the requested type at the database, not filtered afterwards:
    // a household membership must never even be a candidate for the business
    // slot, and vice versa.
    prisma.groupMember.findMany({
      where: { userId, group: { type } },
      select: { groupId: true, createdAt: true },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
      select: { activeGroupId: true },
    }),
  ]);

  const groupId = selectActiveGroupId(
    owned?.id ?? null,
    memberships,
    settings?.activeGroupId ?? null
  );
  if (!groupId) return null;
  if (owned && groupId === owned.id) return owned;

  // The stored activeGroupId is shared across both types, so it can point at
  // the other one. Re-assert the type rather than trusting the selection.
  return prisma.group.findFirst({ where: { id: groupId, type } });
}

/** The caller's membership row in the group they are currently acting in. */
export async function getUserGroupMembership(userId: string, type: GroupType) {
  const group = await getUserGroup(userId, type);
  if (!group) return null;

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId } },
    include: { group: true },
  });
  if (membership) return membership;

  // The owner has full rights without a GroupMember row.
  if (group.ownerId === userId) {
    return {
      id: `owner_${group.id}`,
      groupId: group.id,
      userId,
      role: "owner" as const,
      // Least revealing, matching the column default. An owner who never chose
      // must not be more exposed than a member who never chose.
      shareLevel: "summary",
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      group,
    };
  }
  return null;
}

/** Back-compat aliases for the business-only callers. */
export const getUserBusiness = (userId: string) => getUserGroup(userId, "business");
export const getUserMembership = (userId: string) => getUserGroupMembership(userId, "business");
