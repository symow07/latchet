/**
 * Home's getting-started checklist, as a model (components/GettingStarted.tsx
 * draws it).
 *
 * One row for each source the user passed over at onboarding's Connect your
 * data — their email, a statement, their bank where Plaid serves their region
 * — and one to set a savings goal, which onboarding no longer asks. A row
 * opens the place that does it and ticks itself off once it is done, however
 * it got done (from the row, from Settings, on another device). The card can
 * be hidden, and goes by itself once every row is ticked.
 *
 * Only an account that went through this onboarding has the list: one that
 * finished the old one, or was restored on a new phone, recorded nothing
 * skipped, and is not handed a list it never asked for.
 *
 * Dependency-free; getting-started.test.ts holds it.
 */
import type { SourceId } from './onboarding-flow';

export type ChecklistItemId = SourceId | 'goal';

/** Where each row goes. */
export const CHECKLIST_ROUTES: Readonly<Record<ChecklistItemId, string>> = {
  email: '/email-inbox',
  statement: '/import',
  bank: '/link-bank',
  goal: '/goal',
};

/**
 * Query keys onboarding and the checklist share, so a statement imported or
 * a bank linked from either one ticks both. The availability key is the one
 * link-bank.tsx reads, with the same query.
 */
export const ONBOARDING_QUERY_KEY = ['onboarding'] as const;
export const STATEMENT_IMPORTED_QUERY_KEY = ['statement-imported'] as const;
export const LINKED_BANKS_QUERY_KEY = ['linked-banks'] as const;
export const BANK_AVAILABILITY_QUERY_KEY = ['bank-link-availability'] as const;

/** The order rows appear in. */
const ORDER: readonly ChecklistItemId[] = ['email', 'statement', 'bank', 'goal'];

export interface ChecklistInput {
  /** What onboarding recorded; null when this account has no record from it. */
  onboarding: {
    completed: boolean;
    /** Sources passed over at Connect; undefined for an account onboarded before the checklist existed. */
    skipped: readonly SourceId[] | undefined;
    dismissed: boolean;
  } | null;
  /** Whether each thing is done now. */
  done: Readonly<Record<ChecklistItemId, boolean>>;
  /** Plaid still serves this phone's region (bank-linking's availability). */
  bankAvailable: boolean;
}

export interface ChecklistItem {
  id: ChecklistItemId;
  done: boolean;
  route: string;
}

export interface ChecklistModel {
  visible: boolean;
  items: ChecklistItem[];
  doneCount: number;
  total: number;
}

const HIDDEN: ChecklistModel = { visible: false, items: [], doneCount: 0, total: 0 };

export function gettingStartedModel(input: ChecklistInput): ChecklistModel {
  const o = input.onboarding;
  if (!o || !o.completed || o.dismissed || o.skipped === undefined) return HIDDEN;

  const wanted = new Set<ChecklistItemId>(o.skipped);
  // A bank skipped where it was offered is only offered again while it can be done.
  if (!input.bankAvailable) wanted.delete('bank');
  wanted.add('goal');

  const items = ORDER.filter((id) => wanted.has(id)).map((id) => ({
    id,
    done: !!input.done[id],
    route: CHECKLIST_ROUTES[id],
  }));
  const doneCount = items.filter((i) => i.done).length;
  if (items.length === 0 || doneCount === items.length) return HIDDEN;
  return { visible: true, items, doneCount, total: items.length };
}
