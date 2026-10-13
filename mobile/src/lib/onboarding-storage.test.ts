import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMemorySqlite } from './test-support/memory-sqlite';
import { defaultAccountId, EPOCH_ISO } from './local-schema';
import { reduceOnboarding, startProgress, type OnboardingProgress } from './onboarding-flow';
import {
  createOnboardingStore,
  importedBatchCount,
  parseStoredOnboarding,
  type OnboardingState,
} from './onboarding-storage';
import type { SqlDb } from './db';

/**
 * The onboarding record, run against an in-memory stand-in for one user's
 * AsyncStorage key; and setPersonalCurrency, db.ts's SQL run for real against
 * SQLite (bun:sqlite) as db.test.ts does — db.ts imported under its own query
 * string, because Bun's module mocks are process-wide.
 */

function memoryRecord() {
  const disk = new Map<string, string>();
  let user = 'alice';
  const changes: OnboardingState[] = [];
  const store = createOnboardingStore(
    async () => {
      const key = `onboarding::${user}`;
      return {
        read: async () => disk.get(key) ?? null,
        write: async (value: string) => {
          disk.set(key, value);
        },
      };
    },
    (state) => changes.push(state),
  );
  return { store, disk, changes, setUser: (u: string) => (user = u) };
}

const atConnect = (): OnboardingProgress =>
  [
    { type: 'confirmCurrency', code: 'GBP' } as const,
    { type: 'setIncome', monthlyIncome: 3000, budgetStyle: 'moderate' } as const,
  ].reduce(reduceOnboarding, startProgress());

describe('onboarding flow: the saved record', () => {
  test('progress is saved per user as it goes, and a reopened app reads the same step back', async () => {
    const { store, setUser } = memoryRecord();
    expect(await store.progress()).toBeNull();
    expect(await store.state()).toEqual({ completed: false, inProgress: false });

    await store.saveProgress(atConnect());
    expect((await store.progress())?.step).toBe('connect');
    expect((await store.progress())?.answers.currency).toBe('GBP');
    expect(await store.state()).toEqual({ completed: false, inProgress: true });

    // Another user on the same phone has their own record.
    setUser('bob');
    expect(await store.progress()).toBeNull();
    setUser('alice');
    expect((await store.progress())?.step).toBe('connect');
  });

  test('finishing drops the progress, keeps what was skipped for the checklist, and tells the app', async () => {
    const { store, changes } = memoryRecord();
    await store.saveProgress(atConnect());
    const done = reduceOnboarding(atConnect(), { type: 'finishConnect', offered: ['email', 'statement', 'bank'], connected: ['statement'] });
    await store.complete(done.answers);
    const record = await store.read();
    expect(record?.completed).toBe(true);
    expect(record?.progress).toBeUndefined();
    expect(record?.skippedSources).toEqual(['email', 'bank']);
    expect(record?.checklistDismissed).toBe(false);
    expect(await store.progress()).toBeNull();
    expect(changes.at(-1)).toEqual({ completed: true, inProgress: false });
    // A late save from a screen still open cannot reopen a finished onboarding.
    await store.saveProgress(atConnect());
    expect(await store.state()).toEqual({ completed: true, inProgress: false });

    await store.dismissChecklist();
    expect((await store.read())?.checklistDismissed).toBe(true);
  });

  test('a returning account is marked done without answers; an old build’s record still reads as done', async () => {
    const { store, disk } = memoryRecord();
    await store.saveProgress(atConnect());
    await store.markComplete();
    expect(await store.state()).toEqual({ completed: true, inProgress: false });
    expect((await store.read())?.skippedSources).toBeUndefined();

    disk.set('onboarding::alice', JSON.stringify({ monthlyIncome: 4000, currency: 'EUR', completed: true }));
    const legacy = await store.read();
    expect(legacy?.completed).toBe(true);
    expect(legacy?.skippedSources).toBeUndefined();
  });

  test('a damaged record is no record, and damaged progress is no progress', () => {
    expect(parseStoredOnboarding('{not json')).toBeNull();
    expect(parseStoredOnboarding('[1,2]')).toBeNull();
    expect(parseStoredOnboarding(JSON.stringify({ completed: 'yes', progress: { step: 'connect' } }))).toEqual({
      completed: false,
      checklistDismissed: false,
    });
    expect(parseStoredOnboarding(JSON.stringify({ completed: true, skippedSources: ['email', 'fax'] }))?.skippedSources).toEqual([
      'email',
    ]);
  });

  test('writes queue one after another, so none is lost', async () => {
    const { store } = memoryRecord();
    await Promise.all([store.saveProgress(atConnect()), store.dismissChecklist(), store.saveProgress(atConnect())]);
    const record = await store.read();
    expect(record?.progress?.step).toBe('connect');
    expect(record?.checklistDismissed).toBe(true);
  });

  test('a statement import is known from the batches detection records', () => {
    expect(importedBatchCount(null)).toBe(0);
    expect(importedBatchCount('garbage')).toBe(0);
    expect(importedBatchCount(JSON.stringify([{ from: 'a', to: 'b' }]))).toBe(1);
  });
});

// ── The Cash account takes the chosen currency ───────────────────────────────

const mem = createMemorySqlite();
mock.module('expo-sqlite', () => mem.expoSqlite);
const db = (await import('./db.ts?onboarding' as string)) as typeof import('./db');

let n = 0;
let userId = '';
let handle: SqlDb;
beforeEach(async () => {
  userId = `onboarding-user${++n}`;
  await db.openUserDatabase(userId);
  handle = await db.getDatabase();
});

type Row = { currency: string; clientUpdatedAt: string; dirty: number };

describe('region currency: the Cash account', () => {
  test('a new database seeds Cash in USD; choosing pounds moves the settings and the Cash account together', async () => {
    const seeded = await handle.getFirstAsync<Row>('SELECT currency, clientUpdatedAt, dirty FROM accounts WHERE id = ?', [
      defaultAccountId(userId),
    ]);
    expect(seeded?.currency).toBe('USD');
    expect(seeded?.clientUpdatedAt).toBe(EPOCH_ISO);

    let mutations = 0;
    const stop = db.onLocalMutation(() => {
      mutations += 1;
    });
    await db.setPersonalCurrency('GBP', '£');
    stop();

    const settings = await db.getSettings();
    expect([settings.currency, settings.currencySymbol]).toEqual(['GBP', '£']);
    const cash = await handle.getFirstAsync<Row>('SELECT currency, clientUpdatedAt, dirty FROM accounts WHERE id = ?', [
      defaultAccountId(userId),
    ]);
    // An edit the server receives: stamped, dirty, announced.
    expect(cash?.currency).toBe('GBP');
    expect(cash?.dirty).toBe(1);
    expect(cash?.clientUpdatedAt).not.toBe(EPOCH_ISO);
    expect(mutations).toBe(1);
  });

  test("only the default Cash account follows: another account keeps its own, and the starting balance is untouched", async () => {
    await db.updateSettings({ startingBalance: 1250 });
    const other = await db.createAccount({ name: 'Savings', type: 'savings', balance: 10, currency: 'EUR', color: '#000000', icon: 'wallet' });
    await db.setPersonalCurrency('MAD', 'د.م.');
    const accounts = await db.getAccounts();
    expect(accounts.find((a) => a.id === defaultAccountId(userId))?.currency).toBe('MAD');
    expect(accounts.find((a) => a.id === other)?.currency).toBe('EUR');
    expect((await db.getSettings()).startingBalance).toBe(1250);
  });

  test('re-choosing the same currency does not re-stamp the Cash account; a reset re-creates it in the user’s currency', async () => {
    await db.setPersonalCurrency('EUR', '€');
    const first = await handle.getFirstAsync<Row>('SELECT currency, clientUpdatedAt, dirty FROM accounts WHERE id = ?', [
      defaultAccountId(userId),
    ]);
    await new Promise((r) => setTimeout(r, 5));
    await db.setPersonalCurrency('EUR', '€');
    const again = await handle.getFirstAsync<Row>('SELECT currency, clientUpdatedAt, dirty FROM accounts WHERE id = ?', [
      defaultAccountId(userId),
    ]);
    expect(again?.clientUpdatedAt).toBe(first?.clientUpdatedAt);

    await handle.runAsync('DELETE FROM accounts');
    await db.resetAllData();
    const cash = await handle.getFirstAsync<Row>('SELECT currency FROM accounts WHERE id = ?', [defaultAccountId(userId)]);
    expect(cash?.currency).toBe('EUR');
  });
});
