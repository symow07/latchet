import { test, expect } from 'bun:test';
import {
  detectSubscriptions,
  displayMerchant,
  normalizeMerchant,
  subscriptionId,
  occurrenceId,
  detectCadence,
  predictNextDate,
  monthlyCost,
} from './engine';
import { chargesFromTransactions, chargesFromExpenses, merchantTextOf } from './sources';
import type { SourceCharge } from './types';
import { detectSubscriptions as detectForAnalytics } from '../behavior-detection';

const charge = (over: Partial<SourceCharge> = {}): SourceCharge => ({
  id: 'c1',
  merchant: 'NETFLIX.COM',
  amount: 10.99,
  dateISO: '2026-01-15',
  currency: 'USD',
  source: 'transaction',
  ...over,
});

/** Monthly charges from one merchant. */
const monthly = (merchant: string, amount: number, months: number[], amounts?: number[]) =>
  months.map((m, i) =>
    charge({
      id: `${merchant}-${m}`,
      merchant,
      amount: amounts?.[i] ?? amount,
      dateISO: `2026-${String(m).padStart(2, '0')}-15`,
    })
  );

// ── Bug: grouping by category ────────────────────────────────────────────────

test('a transaction with no note is skipped, not grouped by category', () => {
  // `tx.note || tx.category` made every uncategorised Food expense one
  // merchant, so the app reported "Food — monthly, $45" as a subscription.
  const txs = [1, 2, 3, 4].map((m) => ({
    id: `t${m}`,
    amount: 45,
    category: 'Food',
    type: 'Expense',
    note: null,
    dateISO: `2026-0${m}-10`,
  }));

  expect(chargesFromTransactions(txs)).toEqual([]);
  expect(detectSubscriptions(chargesFromTransactions(txs))).toEqual([]);
});

test('merchant text rejects numbers and dates', () => {
  expect(merchantTextOf('NETFLIX')).toBe('NETFLIX');
  expect(merchantTextOf('')).toBeNull();
  expect(merchantTextOf('   ')).toBeNull();
  expect(merchantTextOf('12.50')).toBeNull();
  expect(merchantTextOf('2026-01-15')).toBeNull();
});

test('transactions with real merchant text still detect', () => {
  const txs = [1, 2, 3, 4].map((m) => ({
    id: `t${m}`,
    amount: 10.99,
    category: 'Subscriptions',
    type: 'Expense',
    note: 'NETFLIX.COM',
    dateISO: `2026-0${m}-15`,
  }));

  const found = detectSubscriptions(chargesFromTransactions(txs));
  expect(found).toHaveLength(1);
  expect(found[0]!.merchantDisplay).toBe('Netflix');
  expect(found[0]!.cadence).toBe('monthly');
});

// ── Bug: id embeds the amount ────────────────────────────────────────────────

test('a price change updates the subscription instead of minting a new one', () => {
  // The id used to embed Math.round(typicalAmount), so £10.99 → £12.99 created
  // a second subscription and left the old one on screen forever.
  const before = detectSubscriptions(monthly('NETFLIX.COM', 10.99, [1, 2, 3]));
  const after = detectSubscriptions(monthly('NETFLIX.COM', 12.99, [4, 5, 6]));

  expect(before[0]!.id).toBe(after[0]!.id);
  expect(before[0]!.id).toBe('sub_netflix');
});

test('the identifier is the merchant alone', () => {
  expect(subscriptionId('NETFLIX')).toBe('sub_netflix');
  expect(subscriptionId('AMAZON PRIME')).toBe('sub_amazon_prime');
});

// ── Bug: occurrences duplicate on every scan ─────────────────────────────────

test('occurrence ids are deterministic, so a re-scan cannot duplicate', () => {
  // These used to be random, so the INSERT OR IGNORE guarding them had nothing
  // to collide with and every scan appended the same charges again.
  expect(occurrenceId('sub_netflix', 'tx_1')).toBe('socc_sub_netflix_tx_1');
  expect(occurrenceId('sub_netflix', 'tx_1')).toBe(occurrenceId('sub_netflix', 'tx_1'));
  expect(occurrenceId('sub_netflix', 'tx_1')).not.toBe(occurrenceId('sub_netflix', 'tx_2'));
});

test('re-running detection over the same charges is stable', () => {
  const charges = monthly('SPOTIFY', 9.99, [1, 2, 3, 4]);
  expect(detectSubscriptions(charges)).toEqual(detectSubscriptions(charges));
});

// ── Detection behaviour ──────────────────────────────────────────────────────

test('cadence is read from the median interval', () => {
  expect(detectCadence([7, 7, 7])).toBe('weekly');
  expect(detectCadence([14, 14, 15])).toBe('biweekly');
  expect(detectCadence([30, 31, 30])).toBe('monthly');
  expect(detectCadence([28, 28, 28])).toBe('monthly');
  expect(detectCadence([90, 91, 92])).toBe('quarterly');
  expect(detectCadence([181, 184])).toBe('semiannual');
  expect(detectCadence([365, 366])).toBe('yearly');
  // One late charge does not change a monthly plan.
  expect(detectCadence([30, 31, 61, 30])).toBe('monthly');
  expect(detectCadence([3, 19, 47])).toBe('unknown');
  expect(detectCadence([])).toBe('unknown');
});

test('an irregular pattern needs more evidence', () => {
  // Two random charges from the same shop are not a subscription.
  const irregular = [
    charge({ id: 'a', merchant: 'CORNER SHOP', dateISO: '2026-01-03', amount: 5 }),
    charge({ id: 'b', merchant: 'CORNER SHOP', dateISO: '2026-01-21', amount: 5 }),
  ];
  expect(detectSubscriptions(irregular)).toEqual([]);
});

test('a single charge is never a subscription', () => {
  expect(detectSubscriptions([charge()])).toEqual([]);
});

test('two plans billed side by side at one merchant are one subscription: the current plan', () => {
  // One subscription per merchant: interleaved charges are not one irregular
  // stream at an average price, but the regular plan with the latest charge.
  const charges = [
    ...monthly('ADOBE', 9.99, [1, 2, 3]),
    ...monthly('ADOBE', 52.99, [1, 2, 3]).map((c) => ({ ...c, id: `${c.id}-pro`, dateISO: c.dateISO.replace(/15$/, '20') })),
  ];
  const found = detectSubscriptions(charges);

  expect(found).toHaveLength(1);
  expect([found[0]!.id, found[0]!.typicalAmount, found[0]!.cadence]).toEqual(['sub_adobe', 52.99, 'monthly']);
});

test('the price is the current one, not an average', () => {
  const [sub] = detectSubscriptions(monthly('NETFLIX.COM', 0, [1, 2, 3, 4, 5], [15.49, 15.49, 15.49, 17.99, 17.99]));
  expect(sub!.typicalAmount).toBe(17.99);
});

test('small price drift stays one subscription', () => {
  // FX movement or a 20p rise must not split the history.
  const found = detectSubscriptions(monthly('SPOTIFY', 0, [1, 2, 3], [9.99, 10.49, 10.99]));
  expect(found).toHaveLength(1);
  expect(found[0]!.occurrences).toHaveLength(3);
});

test('confidence rises with evidence, and confirms above the threshold', () => {
  const thin = detectSubscriptions(monthly('HULU', 8, [1, 2]));
  const thick = detectSubscriptions(monthly('HULU', 8, [1, 2, 3, 4, 5, 6]));

  expect(thick[0]!.confidenceScore).toBeGreaterThan(thin[0]!.confidenceScore);
  expect(thick[0]!.status).toBe('confirmed');
});

test('the next charge date never skips a short month', () => {
  // A subscription billed on the 31st must land on 28 February, not 3 March.
  expect(predictNextDate('2026-01-31', 'monthly', 30)).toBe('2026-02-28');
  expect(predictNextDate('2026-01-15', 'monthly', 30)).toBe('2026-02-15');
  expect(predictNextDate('2026-01-15', 'weekly', 7)).toBe('2026-01-22');
  expect(predictNextDate('2028-02-29', 'yearly', 365)).toBe('2029-02-28');
});

test('normalisation strips payment noise and agrees with the merchant key', () => {
  expect(normalizeMerchant('POS DEBIT NETFLIX.COM')).toBe('NETFLIX');
  expect(normalizeMerchant('SPOTIFY*RECURRING')).toBe('SPOTIFY');
  expect(normalizeMerchant('PRLV SEPA FREE MOBILE REF:FM100234')).toBe('FREE MOBILE');
  expect(normalizeMerchant('   ')).toBe('');
  expect(displayMerchant('DISNEY PLUS')).toBe('Disney+');
  expect(displayMerchant('CORNER SHOP')).toBe('Corner Shop');
});

test('habits, transfers and refunds are never listed', () => {
  const coffee = [1, 2, 3, 4, 5, 6].map((m) => charge({ id: `c${m}`, merchant: 'STARBUCKS STORE 08123', amount: 5.25, dateISO: `2026-0${m}-03` }));
  const rent = [1, 2, 3, 4, 5, 6].map((m) => charge({ id: `r${m}`, merchant: 'VIR SEPA EMIS LOYER', amount: 850, dateISO: `2026-0${m}-01` }));
  expect(detectSubscriptions([...coffee, ...rent])).toEqual([]);
});

test('occurrences carry the charge ids they came from', () => {
  const [sub] = detectSubscriptions(monthly('NETFLIX', 10.99, [1, 2, 3]));
  expect(sub!.occurrences.map((o) => o.chargeId)).toEqual([
    'NETFLIX-1',
    'NETFLIX-2',
    'NETFLIX-3',
  ]);
});

test('monthly cost normalises a yearly cadence', () => {
  const subs = [
    ...detectSubscriptions(monthly('NAMECHEAP DOMAINS', 120, [1]).concat(
      monthly('NAMECHEAP DOMAINS', 120, [1]).map((c) => ({ ...c, id: 'y2', dateISO: '2027-01-15' }))
    )),
  ];
  // A yearly 120 contributes 10/month.
  expect(monthlyCost(subs)).toBeCloseTo(10, 1);
});

// ── Business expenses through the same engine ────────────────────────────────

test('business expenses feed the same detector', () => {
  const expenses = [1, 2, 3, 4].map((m) => ({
    id: `e${m}`,
    amount: 8,
    category: 'Software',
    description: 'Slack',
    submittedAt: `2026-0${m}-15T09:00:00.000Z`,
  }));

  const found = detectSubscriptions(chargesFromExpenses(expenses));
  expect(found).toHaveLength(1);
  expect(found[0]!.merchantDisplay).toBe('Slack');
  expect(found[0]!.source).toBe('expense');
});

test('an expense with no description is skipped', () => {
  expect(
    chargesFromExpenses([
      { id: 'e1', amount: 8, category: 'Software', description: '', submittedAt: '2026-01-15T00:00:00Z' },
    ])
  ).toEqual([]);
});

test('an expense with an unusable date is skipped', () => {
  expect(
    chargesFromExpenses([
      { id: 'e1', amount: 8, category: 'Software', description: 'Slack', submittedAt: 'whenever' },
    ])
  ).toEqual([]);
});

// ── The point of the consolidation: everyone agrees ──────────────────────────

test('the analytics screen and the engine report the same subscriptions', () => {
  // These were separate implementations — analytics grouped by rounded amount
  // plus the first word of the note, subscriptions grouped by normalised
  // merchant — so the two screens could disagree about the same ledger.
  const txs = [1, 2, 3, 4].map((m) => ({
    id: `t${m}`,
    amount: 10.99,
    category: 'Subscriptions',
    type: 'Expense' as const,
    isImpulse: false,
    note: 'NETFLIX.COM',
    dateISO: `2026-0${m}-15`,
    createdAt: `2026-0${m}-15T00:00:00Z`,
    accountId: null,
    currency: 'USD',
  }));

  const viaEngine = detectSubscriptions(chargesFromTransactions(txs));
  const viaAnalytics = detectForAnalytics(txs);

  expect(viaAnalytics).toHaveLength(viaEngine.length);
  expect(viaAnalytics[0]!.description).toBe(viaEngine[0]!.merchantDisplay);
  expect(viaAnalytics[0]!.amount).toBe(viaEngine[0]!.typicalAmount);
  expect(viaAnalytics[0]!.nextExpected).toBe(viaEngine[0]!.nextExpectedAt);
});

test('the analytics screen no longer invents a Food subscription', () => {
  // The old grouping fell back to the category, so four uncategorised Food
  // expenses of similar size became "Food — monthly".
  const txs = [1, 2, 3, 4].map((m) => ({
    id: `t${m}`,
    amount: 45,
    category: 'Food',
    type: 'Expense' as const,
    isImpulse: false,
    note: null,
    dateISO: `2026-0${m}-10`,
    createdAt: `2026-0${m}-10T00:00:00Z`,
    accountId: null,
    currency: 'USD',
  }));

  expect(detectForAnalytics(txs)).toEqual([]);
});
