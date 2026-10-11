/**
 * Who may approve or reject a business expense — the server's rule, once.
 *
 * The server refuses three things (backend/src/routes/expenses.ts): an
 * employee reviewing at all, an expense that is no longer pending, and anyone
 * reviewing their own expense ("Cannot approve your own expense", 403).
 * Expenses used to decide from the role alone, so an owner was offered
 * Approve on an expense they had submitted, tapped it, and got "Something
 * went wrong". Business Home made the same mistake in its count, telling an
 * owner that their own expense was waiting for their review.
 *
 * Both screens now ask this module. Dependency-free so the rule is tested
 * without a simulator; the screens turn its answers into words.
 */

/** The parts of an expense the rule reads. */
export interface ReviewableExpense {
  status: string;
  submitterId?: string | null;
  /** The nested submitter the list endpoint includes; the same person. */
  submitter?: { id: string } | null;
}

/** Why review is not offered, or null when it is. */
export type ReviewBlock = 'notPending' | 'signedOut' | 'ownExpense' | 'notApprover';

/** The roles the server lets review: everyone but an employee. */
const APPROVER_ROLES = new Set(['owner', 'manager']);

export function isApprover(role: string | null | undefined): boolean {
  return !!role && APPROVER_ROLES.has(role);
}

function submitterOf(expense: ReviewableExpense): string | null {
  return expense.submitterId ?? expense.submitter?.id ?? null;
}

/**
 * Why `viewerId`, in `role`, may not review `expense` — or null if they may.
 *
 * Order matters only for the reason given, never for the answer: a settled
 * expense needs no explanation, and your own expense is "waiting for someone
 * else" whatever your role.
 */
export function reviewBlock(
  expense: ReviewableExpense,
  viewerId: string | null | undefined,
  role: string | null | undefined
): ReviewBlock | null {
  if (expense.status !== 'pending') return 'notPending';
  if (!viewerId) return 'signedOut';
  if (submitterOf(expense) === viewerId) return 'ownExpense';
  if (!isApprover(role)) return 'notApprover';
  return null;
}

/** Whether to offer Approve and Reject: an owner or manager, a pending expense, not their own. */
export function canReviewExpense(
  expense: ReviewableExpense,
  viewerId: string | null | undefined,
  role: string | null | undefined
): boolean {
  return reviewBlock(expense, viewerId, role) === null;
}

/**
 * What a pending expense without buttons says instead, as a key under
 * `businessExpenses` — or null when nothing needs saying (it is settled, or
 * the session is still loading).
 *
 * An approver looking at their own expense is waiting for *another*
 * approver; everyone else is waiting for the owner or a manager.
 */
export function reviewNote(
  expense: ReviewableExpense,
  viewerId: string | null | undefined,
  role: string | null | undefined
): 'waitingForOther' | 'waitingForApprover' | null {
  const block = reviewBlock(expense, viewerId, role);
  if (block === 'ownExpense') return isApprover(role) ? 'waitingForOther' : 'waitingForApprover';
  if (block === 'notApprover') return 'waitingForApprover';
  return null;
}

/**
 * Business Home's queue: the pending expenses this viewer can act on, and
 * the pending ones they submitted (which wait on somebody else).
 */
export function pendingForViewer(
  expenses: readonly ReviewableExpense[],
  viewerId: string | null | undefined,
  role: string | null | undefined
): { toReview: number; mine: number } {
  let toReview = 0;
  let mine = 0;
  for (const e of expenses) {
    if (e.status !== 'pending') continue;
    if (canReviewExpense(e, viewerId, role)) toReview++;
    else if (viewerId && submitterOf(e) === viewerId) mine++;
  }
  return { toReview, mine };
}
