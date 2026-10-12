import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DECISION_STATUS, insertOccurrenceRow, writeDetectedSubscription, writeSubscriptionDecision } from './subscription-rows';
import { openTestUserDatabase, type TestUserDatabase } from './test-sqlite';

/**
 * The subscription write rules on their own, on the phone's real schema
 * (db.test.ts covers them again through db.ts's functions).
 */

let t: TestUserDatabase;
beforeEach(() => {
  t = openTestUserDatabase('user_rows', '2026-10-01T00:00:00.000Z');
});
afterEach(() => t.close());

const row = (id: string) =>
  t.db.raw.query(`SELECT * FROM subscriptions WHERE id = ?`).get(id) as Record<string, unknown> | null;

const engine = {
  merchantDisplay: 'Spotify',
  merchantNormalized: 'spotify',
  cadence: 'monthly',
  typicalAmount: 10.99,
  currency: 'EUR',
  confidenceScore: 0.8,
  status: 'active',
  source: 'transaction',
  sources: 'transaction',
};

describe('the engine write', () => {
  test('a decision that arrived by sync, not through this module, still holds the status', async () => {
    await writeDetectedSubscription(t.db, { id: 'sub_1', values: engine, at: '2026-10-02T00:00:00.000Z' });
    // A pull wrote it: decision set, no status of its own yet.
    t.db.raw.query(`UPDATE subscriptions SET decision = 'dismiss', status = 'possible', dirty = 0`).run();
    expect(
      await writeDetectedSubscription(t.db, {
        id: 'sub_1',
        values: { ...engine, typicalAmount: 11.99, status: 'trial' },
        at: '2026-10-03T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(row('sub_1')).toMatchObject({
      decision: 'dismiss',
      status: DECISION_STATUS.dismiss,
      typicalAmount: 11.99,
      clientUpdatedAt: '2026-10-03T00:00:00.000Z',
      dirty: 1,
    });
  });

  test('a new row needs a merchant; one deleted here before is re-created and its tombstone lifted', async () => {
    await expect(
      writeDetectedSubscription(t.db, { id: 'sub_x', values: { ...engine, merchantDisplay: '' }, at: '2026-10-02T00:00:00.000Z' }),
    ).rejects.toThrow(/required/);
    t.db.raw.query(`INSERT INTO sync_tombstones (entity, id, clientUpdatedAt) VALUES ('subscriptions', 'sub_2', ?)`).run(
      '2026-10-01T00:00:00.000Z',
    );
    await writeDetectedSubscription(t.db, {
      id: 'sub_2',
      values: { ...engine, decision: 'bogus' },
      createdAt: '2026-09-01T00:00:00.000Z',
      at: '2026-10-02T00:00:00.000Z',
    });
    expect(row('sub_2')).toMatchObject({ decision: null, status: 'active', createdAt: '2026-09-01T00:00:00.000Z', dirty: 1 });
    expect(t.db.raw.query(`SELECT COUNT(*) AS n FROM sync_tombstones`).get()).toEqual({ n: 0 });
  });
});

describe('the user write', () => {
  test('only cancel keeps a cancellation date; a missing row is not created', async () => {
    await writeDetectedSubscription(t.db, { id: 'sub_1', values: engine, at: '2026-10-02T00:00:00.000Z' });
    await writeSubscriptionDecision(t.db, 'sub_1', 'cancel', { canceledAt: '2026-10-04', at: '2026-10-04T09:00:00.000Z' });
    expect(row('sub_1')).toMatchObject({ decision: 'cancel', canceledAt: '2026-10-04', status: 'canceled' });
    await writeSubscriptionDecision(t.db, 'sub_1', 'keep', { canceledAt: '2026-10-05', at: '2026-10-05T09:00:00.000Z' });
    expect(row('sub_1')).toMatchObject({ decision: 'keep', canceledAt: null, status: 'confirmed' });
    expect(await writeSubscriptionDecision(t.db, 'nope', 'keep', { canceledAt: null, at: '2026-10-05T09:00:00.000Z' })).toBe(false);
    expect(row('nope')).toBeNull();
  });
});

test('an occurrence without a transaction is recorded by its id alone', async () => {
  const occ = { id: 'o1', subscriptionId: 'sub_1', transactionId: null, chargedAt: '2026-10-01', amount: 5 };
  expect(await insertOccurrenceRow(t.db, occ)).toBe(true);
  expect(await insertOccurrenceRow(t.db, occ)).toBe(false);
  expect(await insertOccurrenceRow(t.db, { ...occ, id: 'o2', chargedAt: '2026-11-01' })).toBe(true);
});
