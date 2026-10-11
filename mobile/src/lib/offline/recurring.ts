/**
 * The recurring screen's logic — the new-series form, its account, and "run
 * now" — with no React, no SQLite and no network, so `bun test` holds it.
 *
 * Where a series' occurrences land (Phase 4 decision 5): the account the form
 * picked, which starts on the user's default account. The server books onto
 * the series' account when the user still has it, and otherwise onto the
 * default account; the screen says the same thing the server will do.
 *
 * Run now (decision 6) is the one thing on the screen that needs the server:
 * it books today's occurrence there, under the id the recurring job uses, so
 * the two can never both book a day. A series made offline has to reach the
 * server first, so run-now sends what is pending, books only once this series
 * is the server's version, then pulls the booking down. Offline it books
 * nothing and says so.
 */
import { MAX_AMOUNT } from './limits';

export type RecurringFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export type RecurringType = 'Expense' | 'Income';

export const RECURRING_CATEGORIES = ['Food', 'Gym', 'Transport', 'Shopping', 'Subscriptions', 'Other'] as const;
export type RecurringCategory = (typeof RECURRING_CATEGORIES)[number];

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

/** An account as the picker needs it; db.ts's Account fits. */
export interface AccountChoice {
  id: string;
  name: string;
  isDefault: number | boolean;
  createdAt: string;
}

/**
 * The account a new series starts on: the user's default account — the
 * oldest one marked default, as the server chooses — else the first account,
 * else none.
 */
export function defaultAccountFor<A extends AccountChoice>(accounts: readonly A[]): A | null {
  const defaults = accounts.filter((a) => a.isDefault === 1 || a.isDefault === true);
  const pool = defaults.length > 0 ? defaults : accounts;
  return [...pool].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))[0] ?? null;
}

/**
 * The account a series' occurrences are booked onto: its own, if this phone
 * still has it; otherwise — no account, or one deleted here or on another
 * device that the server will unlink — the default account.
 */
export function bookingAccountFor<A extends AccountChoice>(accountId: string | null, accounts: readonly A[]): A | null {
  return (accountId ? accounts.find((a) => a.id === accountId) : undefined) ?? defaultAccountFor(accounts);
}

/** What the new-series form holds. */
export interface RecurringForm {
  type: RecurringType;
  name: string;
  amount: string;
  category: RecurringCategory;
  frequency: RecurringFrequency;
  /** The account the user picked; null until they pick one (the default account is used). */
  accountId: string | null;
  /** A locale key, or null. */
  error: string | null;
}

export const EMPTY_RECURRING_FORM: RecurringForm = {
  type: 'Expense',
  name: '',
  amount: '',
  category: 'Subscriptions',
  frequency: 'monthly',
  accountId: null,
  error: null,
};

export type RecurringFormAction =
  | { type: 'edit'; patch: Partial<Omit<RecurringForm, 'error'>> }
  | { type: 'replace'; form: RecurringForm }
  | { type: 'reset' };

export function recurringFormReducer(state: RecurringForm, action: RecurringFormAction): RecurringForm {
  switch (action.type) {
    case 'edit':
      return { ...state, ...action.patch };
    case 'replace':
      return action.form;
    case 'reset':
      return EMPTY_RECURRING_FORM;
  }
}

/** A new series, as db.ts's addRecurring takes it. */
export interface RecurringDraft {
  accountId: string | null;
  name: string;
  amount: number;
  category: string;
  type: RecurringType;
  isImpulse: boolean;
  frequency: RecurringFrequency;
  startDate: string;
  nextDate: string;
  currency: string;
}

export interface RecurringFormContext {
  /** The local calendar date: the series starts, and first runs, today. */
  today: string;
  /** The user's currency: the server replays it into every occurrence. */
  currency: string;
  accounts: readonly AccountChoice[];
}

/** The series the form describes, or the locale key of what is wrong with it. */
export function draftFromForm(
  form: RecurringForm,
  ctx: RecurringFormContext,
): { ok: true; draft: RecurringDraft } | { ok: false; error: string } {
  const name = form.name.trim();
  if (!name) return { ok: false, error: 'recurring.errName' };
  const amount = parseFloat(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'recurring.errAmount' };
  if (amount > MAX_AMOUNT) return { ok: false, error: 'common.amountTooLarge' };
  // The pick, while it still exists; else the default account. Saved as an
  // id, so the series says where it books rather than leaving it implied.
  const account = bookingAccountFor(form.accountId, ctx.accounts);
  return {
    ok: true,
    draft: {
      accountId: account?.id ?? null,
      name,
      amount,
      category: form.category,
      type: form.type,
      isImpulse: false,
      frequency: form.frequency,
      startDate: ctx.today,
      nextDate: ctx.today,
      currency: ctx.currency || 'USD',
    },
  };
}

/**
 * Create the series the form describes and say what the form holds next: an
 * empty form once it is saved — the next "New Recurring" starts clean, where
 * it used to open on the last one's values — or the same form with the error
 * when it cannot be saved, so nothing typed is lost.
 */
export async function createRecurringFromForm(
  form: RecurringForm,
  ctx: RecurringFormContext,
  save: (draft: RecurringDraft) => Promise<string>,
): Promise<{ form: RecurringForm; createdId: string | null }> {
  const parsed = draftFromForm(form, ctx);
  if (!parsed.ok) return { form: { ...form, error: parsed.error }, createdId: null };
  try {
    const createdId = await save(parsed.draft);
    return { form: EMPTY_RECURRING_FORM, createdId };
  } catch {
    return { form: { ...form, error: 'recurring.saveFailed' }, createdId: null };
  }
}

// ── Run now ──────────────────────────────────────────────────────────────────

/**
 * Where a row stands with the server, from this phone's side:
 *   synced   the server accepted this version (or sent it)
 *   pending  changed here and not sent yet
 *   refused  the server refused it; it is not sent again until edited
 *   missing  not on this phone (deleted here, or by a pull)
 */
export type LocalSyncState = 'synced' | 'pending' | 'refused' | 'missing';

export interface RunNowDeps {
  /** Send what is pending and pull (cloud-sync's syncNow). Null when no sync can run. */
  flush(): Promise<unknown>;
  syncState(seriesId: string): Promise<LocalSyncState>;
  /** POST /api/v1/recurring/:id/run. */
  run(seriesId: string): Promise<unknown>;
  /** Ask for the server's latest without waiting (cloud-sync's requestPull). */
  pull(): void;
  /** The request never reached the server: offline, or timed out. */
  isConnectionError(e: unknown): boolean;
}

/**
 *   booked    today's occurrence is booked (now, or by an earlier tap or the job)
 *   offline   the series could not be sent, or the server could not be reached:
 *             nothing was booked
 *   failed    the server refused the series or the request; nothing was booked
 */
export type RunNowOutcome = 'booked' | 'offline' | 'failed';

export async function runRecurringNow(seriesId: string, deps: RunNowDeps): Promise<RunNowOutcome> {
  // First what is pending — this series above all, if it was made or changed
  // offline: booked from an older version, or not at all if the server has
  // never seen it.
  try {
    await deps.flush();
  } catch {
    // syncNow never rejects; whatever happened, the series' state says it.
  }
  const state = await deps.syncState(seriesId);
  if (state === 'pending') return 'offline';
  if (state !== 'synced') return 'failed';
  try {
    await deps.run(seriesId);
  } catch (e) {
    return deps.isConnectionError(e) ? 'offline' : 'failed';
  }
  // The booking and the series moved past today come down with the pull.
  deps.pull();
  return 'booked';
}

/** The locale key of what to tell the user, or null when the result speaks for itself. */
export function runNowMessage(outcome: RunNowOutcome): string | null {
  switch (outcome) {
    case 'booked':
      return null;
    case 'offline':
      return 'recurring.runNowOffline';
    case 'failed':
      return 'recurring.runNowFailed';
  }
}
