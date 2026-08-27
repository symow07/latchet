/**
 * Reading a group's member list across a backend rename.
 *
 * The server used to send `teamMembers` and now sends `members`. A web app
 * could treat that as a flag day; a mobile app cannot. Builds sit on devices
 * for weeks, the backend deploys on its own schedule, and for some window
 * every combination of the two is live at once.
 *
 * This is not hypothetical here: the app was left rendering a black screen
 * because it read `business.members` from a backend still sending
 * `teamMembers`, and `business?.members.find(...)` optional-chains the
 * BUSINESS, not the members — so an absent list threw rather than resolving
 * to undefined.
 */

/** The subset both shapes agree on. */
export interface MemberLike {
  userId: string;
  role: string;
}

interface EitherShape {
  members?: MemberLike[] | null;
  /** What the backend sent before groups were generalised. */
  teamMembers?: MemberLike[] | null;
}

/**
 * Always an array. Callers can `.find()` on the result without a guard, which
 * is the point: the crash came from a call site that looked safe.
 */
export function readMembers(group: EitherShape | null | undefined): MemberLike[] {
  if (!group) return [];
  if (Array.isArray(group.members)) return group.members;
  if (Array.isArray(group.teamMembers)) return group.teamMembers;
  return [];
}

/** The caller's role in a group, or undefined if they are not in it. */
export function roleOf(
  group: EitherShape | null | undefined,
  userId: string | null | undefined
): string | undefined {
  if (!userId) return undefined;
  return readMembers(group).find((m) => m.userId === userId)?.role;
}
