/**
 * Real-looking statements from five countries, through the real import parser
 * and the engine. Each fixture says, by hand, what a careful person reading
 * the statement would expect: which subscriptions, at what price and status,
 * which merchants are not subscriptions, and which events are raised.
 *
 *   fixtures/<cc>/fixture.json  { statement, importSource, currency, today, existing, email, expect }
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseStatement, type ImportSource } from '../import-parser';
import { reconcileSubscriptions } from './engine';
import type { EmailEvidence, SubscriptionRecord } from './types';

interface Fixture {
  statement: string;
  importSource: ImportSource;
  currency: string;
  today: string;
  existing?: SubscriptionRecord[];
  email?: EmailEvidence[];
  expect: {
    subscriptions: ({ key: string } & Partial<Record<keyof SubscriptionRecord, unknown>>)[];
    absent: string[];
    events?: string[];
  };
}

const ROOT = join(import.meta.dir, 'fixtures');
const COUNTRIES = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

function load(cc: string) {
  const fx = JSON.parse(readFileSync(join(ROOT, cc, 'fixture.json'), 'utf8')) as Fixture;
  const txs = parseStatement(readFileSync(join(ROOT, cc, fx.statement), 'utf8'), fx.importSource, {}, { currency: fx.currency });
  const charges = txs
    .filter((t) => t.type === 'Expense')
    .map((t) => ({
      id: t.id,
      merchant: t.description,
      amount: Math.abs(t.amount),
      dateISO: t.date,
      currency: t.currency ?? fx.currency,
      source: 'import' as const,
      category: t.suggestedCategory,
    }));
  return { fx, txs, charges };
}

describe('statement fixtures', () => {
  test('there is one for each of the five countries', () => {
    expect(COUNTRIES).toEqual(['cn', 'fr', 'ma', 'uk', 'us']);
  });

  for (const cc of COUNTRIES) {
    test(`${cc}: the statement reconciles as expected, and a second run is quiet`, () => {
      const { fx, txs, charges } = load(cc);
      expect(txs.length).toBeGreaterThanOrEqual(30);

      const existing = fx.existing ?? [];
      const res = reconcileSubscriptions({ charges, email: fx.email ?? [], existing, today: fx.today });
      const state = new Map(existing.map((r) => [r.id, r]));
      for (const m of res.merges) state.delete(m.fromId);
      for (const u of res.upserts) state.set(u.id, u);
      const rows = [...state.values()];

      for (const want of fx.expect.subscriptions) {
        const found = rows.filter((r) => r.merchantNormalized === want.key);
        expect([want.key, found.length]).toEqual([want.key, 1]);
        const got = found[0]!;
        for (const [field, value] of Object.entries(want)) {
          if (field === 'key') continue;
          const actual: unknown = got[field as keyof SubscriptionRecord];
          if (typeof value === 'number') expect([want.key, field, actual]).toEqual([want.key, field, expect.closeTo(value, 2) as unknown]);
          else expect([want.key, field, actual]).toEqual([want.key, field, value]);
        }
      }
      // Nothing outside the expectations is proposed: every row is either
      // expected or one the user already had.
      const named = new Set(fx.expect.subscriptions.map((s) => s.key));
      const surprises = rows.filter((r) => !named.has(r.merchantNormalized) && !existing.some((e) => e.id === r.id));
      expect(surprises.map((r) => r.merchantNormalized)).toEqual([]);
      for (const key of fx.expect.absent) expect([key, rows.some((r) => r.merchantNormalized === key)]).toEqual([key, false]);

      const types = new Set<string>(res.events.map((e) => e.type));
      for (const t of fx.expect.events ?? []) expect([t, types.has(t)]).toEqual([t, true]);

      const again = reconcileSubscriptions({ charges, email: fx.email ?? [], existing: rows, today: fx.today });
      expect([again.upserts, again.events, again.merges]).toEqual([[], [], []]);
    });
  }
});
