/**
 * What a group member reveals about themselves.
 *
 * shareLevel is chosen BY the member, ABOUT the member. It is not a permission
 * someone else holds over them, and nothing in the group — not the owner, not
 * a manager — can raise it. That asymmetry is the whole design: App Store
 * guideline 5.1.2 rejects apps that let one person monitor another, and the
 * difference between sharing and monitoring is who holds the dial.
 *
 * This module is pure so the projection can be tested exhaustively without a
 * database. The API layer must call it on the way out; the UI hiding a field
 * is not enforcement, because the field already crossed the wire.
 */

export const SHARE_LEVELS = ["summary", "categories", "full"] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];

/** Anything unrecognised — a null column, a newer client, a typo — is summary. */
export function normalizeShareLevel(value: unknown): ShareLevel {
  return (SHARE_LEVELS as readonly string[]).includes(value as string)
    ? (value as ShareLevel)
    : "summary";
}

export interface MemberTransaction {
  id: string;
  accountId: string | null;
  amount: number;
  type: string;
  category: string;
  note: string | null;
  dateISO: string;
}

/** Everything the server knows about one member's finances, before projection. */
export interface MemberFinances {
  userId: string;
  name: string;
  totalIn: number;
  totalOut: number;
  byCategory: Record<string, number>;
  transactions: MemberTransaction[];
}

/** What the rest of the group is allowed to see of that member. */
export interface ProjectedMember {
  userId: string;
  name: string;
  shareLevel: ShareLevel;
  totalIn: number;
  totalOut: number;
  /** Present only at 'categories' and above. */
  byCategory?: Record<string, number>;
  /** Present only at 'full'. */
  transactions?: MemberTransaction[];
}

/**
 * Reduce one member's finances to what their own shareLevel permits.
 *
 * Note what is NOT here: any argument describing the viewer. A member's
 * projection is identical for everyone in the group including the owner,
 * because a level someone else could widen is not a level the member controls.
 *
 * Totals are always included — 'summary' is the floor, not silence. Being in a
 * household means contributing a number to it; a member who wants to
 * contribute nothing leaves the group.
 */
export function projectMember(finances: MemberFinances, rawLevel: unknown): ProjectedMember {
  const shareLevel = normalizeShareLevel(rawLevel);

  const base: ProjectedMember = {
    userId: finances.userId,
    name: finances.name,
    shareLevel,
    totalIn: finances.totalIn,
    totalOut: finances.totalOut,
  };

  if (shareLevel === "summary") return base;

  // Copied, not referenced: a caller mutating the result must not be able to
  // reach back into the unprojected row.
  base.byCategory = { ...finances.byCategory };
  if (shareLevel === "categories") return base;

  base.transactions = finances.transactions.map((t) => ({ ...t }));
  return base;
}

/**
 * A shared account is an opt-in view, not a new entity.
 *
 * `BankAccount.sharedWithGroupId` makes one account visible to the group in
 * full regardless of its owner's shareLevel — which is how a couple share a
 * joint account without the app inventing joint ownership. The opt-in is per
 * account and per group, so it cannot be a back door into the rest of the
 * owner's finances: only transactions belonging to that account qualify.
 */
export function projectSharedAccountTransactions(
  transactions: MemberTransaction[],
  sharedAccountIds: ReadonlySet<string>
): MemberTransaction[] {
  return transactions
    .filter((t) => t.accountId !== null && sharedAccountIds.has(t.accountId))
    .map((t) => ({ ...t }));
}
