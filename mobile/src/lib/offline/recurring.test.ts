import { beforeAll, describe, expect, test } from 'bun:test';
import { setLocale, t } from '../i18n/core';
import {
  EMPTY_RECURRING_FORM,
  bookingAccountFor,
  createRecurringFromForm,
  defaultAccountFor,
  draftFromForm,
  recurringFormReducer,
  runNowMessage,
  runRecurringNow,
  type AccountChoice,
  type LocalSyncState,
  type RecurringDraft,
  type RecurringForm,
  type RunNowDeps,
} from './recurring';

beforeAll(() => setLocale('en'));

const cash: AccountChoice = { id: 'acc_default_u1', name: 'Cash', isDefault: 1, createdAt: '2026-01-01T00:00:00.000Z' };
const bank: AccountChoice = { id: 'acc_bank', name: 'Bank', isDefault: 0, createdAt: '2026-02-01T00:00:00.000Z' };
const card: AccountChoice = { id: 'acc_card', name: 'Card', isDefault: 0, createdAt: '2026-03-01T00:00:00.000Z' };

const ctx = (accounts: AccountChoice[] = [bank, cash, card]) => ({ today: '2026-10-11', currency: 'EUR', accounts });

const filled = (over: Partial<RecurringForm> = {}): RecurringForm => ({
  ...EMPTY_RECURRING_FORM,
  name: '  Rent ',
  amount: '700',
  category: 'Other',
  frequency: 'monthly',
  ...over,
});

describe('recurring account', () => {
  test('the default account is the oldest marked default, else the first account, else none', () => {
    const laterDefault = { ...card, isDefault: 1 };
    expect(defaultAccountFor([bank, laterDefault, cash])?.id).toBe(cash.id);
    expect(defaultAccountFor([{ ...card, isDefault: true }])?.id).toBe(card.id);
    expect(defaultAccountFor([card, bank])?.id).toBe(bank.id);
    expect(defaultAccountFor([])).toBeNull();
  });

  test('a form nobody picked an account on saves the default account', () => {
    const parsed = draftFromForm(filled(), ctx());
    expect(parsed).toEqual({
      ok: true,
      draft: {
        accountId: cash.id,
        name: 'Rent',
        amount: 700,
        category: 'Other',
        type: 'Expense',
        isImpulse: false,
        frequency: 'monthly',
        startDate: '2026-10-11',
        nextDate: '2026-10-11',
        currency: 'EUR',
      },
    });
  });

  test('the account picked is the one saved; one deleted since it was picked falls back to the default', () => {
    const picked = draftFromForm(filled({ accountId: bank.id }), ctx());
    expect(picked.ok && picked.draft.accountId).toBe(bank.id);
    const gone = draftFromForm(filled({ accountId: 'acc_deleted' }), ctx([cash, card]));
    expect(gone.ok && gone.draft.accountId).toBe(cash.id);
    // A user with no accounts at all: the server books onto none, or its own default.
    const none = draftFromForm(filled(), ctx([]));
    expect(none.ok && none.draft.accountId).toBeNull();
  });

  test('a series shows the account it books onto: its own, or the default when it has none or it was deleted', () => {
    const accounts = [cash, bank];
    expect(bookingAccountFor(bank.id, accounts)?.name).toBe('Bank');
    expect(bookingAccountFor(null, accounts)?.name).toBe('Cash');
    // Deleted on this phone, or by a pull; the server unlinks it and books onto the default.
    expect(bookingAccountFor('acc_gone', accounts)?.name).toBe('Cash');
  });

  test('the picker keeps its choice through edits, and a reset goes back to the default', () => {
    let form = recurringFormReducer(EMPTY_RECURRING_FORM, { type: 'edit', patch: { accountId: card.id } });
    form = recurringFormReducer(form, { type: 'edit', patch: { name: 'Gym' } });
    expect(form.accountId).toBe(card.id);
    expect(recurringFormReducer(form, { type: 'reset' }).accountId).toBeNull();
  });
});

describe('phase4 screens', () => {
  test('the recurring form resets after a successful create, and keeps what was typed when the save fails', async () => {
    const saved: RecurringDraft[] = [];
    const form = filled({ accountId: bank.id, type: 'Income', frequency: 'weekly' });

    const created = await createRecurringFromForm(form, ctx(), async (draft) => {
      saved.push(draft);
      return 'rec_1';
    });
    expect(created.createdId).toBe('rec_1');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Rent', type: 'Income', frequency: 'weekly', accountId: bank.id });
    // The next "New Recurring" opens empty, on the default account.
    expect(created.form).toEqual(EMPTY_RECURRING_FORM);
    expect(recurringFormReducer(form, { type: 'replace', form: created.form })).toEqual(EMPTY_RECURRING_FORM);

    const failed = await createRecurringFromForm(form, ctx(), async () => {
      throw new Error('database is closed');
    });
    expect(failed).toEqual({ form: { ...form, error: 'recurring.saveFailed' }, createdId: null });

    const invalid = await createRecurringFromForm(filled({ amount: '0' }), ctx(), async () => 'never');
    expect(invalid.createdId).toBeNull();
    expect(invalid.form).toMatchObject({ name: '  Rent ', error: 'recurring.errAmount' });
    expect((await createRecurringFromForm(filled({ name: ' ' }), ctx(), async () => 'never')).form.error).toBe('recurring.errName');
    expect((await createRecurringFromForm(filled({ amount: '20000000' }), ctx(), async () => 'never')).form.error).toBe(
      'common.amountTooLarge',
    );
  });

  test('run-now offline says it needs a connection, and books nothing', async () => {
    const calls: string[] = [];
    const deps = (state: LocalSyncState, run: () => Promise<unknown> = async () => ({})): RunNowDeps => ({
      flush: async () => {
        calls.push('flush');
        return { ok: false };
      },
      syncState: async () => state,
      run: async (id) => {
        calls.push(`run ${id}`);
        return run();
      },
      pull: () => calls.push('pull'),
      isConnectionError: (e) => e instanceof Error && e.name === 'NetworkError',
    });

    // Made offline and still unsent: the server has never seen it.
    expect(await runRecurringNow('rec_new', deps('pending'))).toBe('offline');
    expect(calls).toEqual(['flush']);
    const message = runNowMessage('offline');
    expect(message).toBe('recurring.runNowOffline');
    expect(t(message!)).toBe("Run now needs a connection. Nothing was booked — try again when you're online.");

    // Sent long ago, but the run request cannot reach the server either.
    calls.length = 0;
    const offline = Object.assign(new Error('Network request failed'), { name: 'NetworkError' });
    expect(await runRecurringNow('rec_old', deps('synced', () => Promise.reject(offline)))).toBe('offline');
    expect(calls).toEqual(['flush', 'run rec_old']);
  });

  test('run-now sends the pending series first, then books it, then pulls', async () => {
    const calls: string[] = [];
    let state: LocalSyncState = 'pending';
    const outcome = await runRecurringNow('rec_new', {
      flush: async () => {
        calls.push('flush');
        state = 'synced';
      },
      syncState: async () => state,
      run: async (id) => calls.push(`run ${id}`),
      pull: () => calls.push('pull'),
      isConnectionError: () => false,
    });
    expect(outcome).toBe('booked');
    expect(runNowMessage(outcome)).toBeNull();
    expect(calls).toEqual(['flush', 'run rec_new', 'pull']);

    // A series the server refused, or one a pull removed, is never run.
    for (const refused of ['refused', 'missing'] as const) {
      const ran: string[] = [];
      const result = await runRecurringNow('rec_x', {
        flush: async () => null,
        syncState: async () => refused,
        run: async (id) => ran.push(id),
        pull: () => ran.push('pull'),
        isConnectionError: () => false,
      });
      expect(result).toBe('failed');
      expect(ran).toEqual([]);
    }
    expect(t(runNowMessage('failed')!)).toContain('Nothing was booked');
  });
});
