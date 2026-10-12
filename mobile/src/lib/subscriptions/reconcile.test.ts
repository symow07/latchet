import { describe, expect, test } from 'bun:test';
import { monthlyCost, reconcileSubscriptions } from './engine';
import type { EmailEvidence, ReconcileResult, SourceCharge, SubscriptionRecord } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Calendar arithmetic on YYYY-MM-DD in UTC, the same in every timezone. */
function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
const monthsOf = (year: number, fromMonth: number, n: number, day: number) =>
  Array.from({ length: n }, (_, i) => {
    const m = fromMonth - 1 + i;
    return `${year + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });
const everyDays = (from: string, n: number, step: number) => Array.from({ length: n }, (_, i) => addDays(from, i * step));

const charge = (id: string, merchant: string, amount: number, dateISO: string, source: SourceCharge['source'] = 'bank', currency = 'USD'): SourceCharge => ({
  id,
  merchant,
  amount,
  dateISO,
  currency,
  source,
});
const series = (prefix: string, merchant: string, amount: number, dates: string[], source: SourceCharge['source'] = 'bank', currency = 'USD') =>
  dates.map((d, i) => charge(`${prefix}${i}`, merchant, amount, d, source, currency));

const mail = (over: Partial<EmailEvidence> & Pick<EmailEvidence, 'id' | 'kind' | 'dateISO'>): EmailEvidence => ({
  merchant: null,
  senderDomain: null,
  billedVia: null,
  amount: null,
  currency: null,
  cadence: 'unknown',
  chargedISO: null,
  nextChargeISO: null,
  trialEndsISO: null,
  previousAmount: null,
  source: 'gmail',
  ...over,
});

/** A stored row; `createdAt` is what the phone's rows carry beside the engine's fields. */
const row = (over: Partial<SubscriptionRecord> & Pick<SubscriptionRecord, 'id' | 'merchantNormalized'> & { createdAt?: string }): SubscriptionRecord => ({
  merchantDisplay: '',
  cadence: 'monthly',
  typicalAmount: 0,
  currency: 'USD',
  confidenceScore: 80,
  lastChargedAt: null,
  nextExpectedAt: null,
  status: 'possible',
  cancelUrl: null,
  cancelNotes: null,
  source: 'transaction',
  sources: 'transaction',
  decision: null,
  canceledAt: null,
  trialEndsAt: null,
  previousAmount: null,
  priceChangedAt: null,
  alert: null,
  billedVia: null,
  ...over,
});

/** Runs the engine and applies what it returns, the way the phone's runner does. */
function run(charges: SourceCharge[], email: EmailEvidence[] = [], existing: SubscriptionRecord[] = [], today = '2026-10-12') {
  const res = reconcileSubscriptions({ charges, email, existing, today });
  const state = new Map(existing.map((r) => [r.id, r]));
  for (const m of res.merges) state.delete(m.fromId);
  for (const u of res.upserts) state.set(u.id, u);
  const rows = [...state.values()];
  return {
    res,
    rows,
    one: (key: string) => {
      const found = rows.filter((r) => r.merchantNormalized === key);
      expect(found.map((r) => r.merchantNormalized)).toEqual([key]);
      return found[0]!;
    },
    again: (more: SourceCharge[] = [], moreEmail: EmailEvidence[] = [], at = today) =>
      run([...charges, ...more], [...email, ...moreEmail], rows, at),
  };
}
const quiet = (res: ReconcileResult) => {
  expect(res.upserts).toEqual([]);
  expect(res.events).toEqual([]);
  expect(res.merges).toEqual([]);
};

const NETFLIX = 'NETFLIX.COM 866-579-7172 CA';

// ── One Netflix ──────────────────────────────────────────────────────────────

describe('one netflix', () => {
  test('a bank charge, a statement line and an email receipt for each month are one subscription with one occurrence a month', () => {
    const dates = ['2026-06-14', '2026-07-14', '2026-08-14', '2026-09-14'];
    const bank = dates.map((d, i) => charge(`bank${i}`, NETFLIX, 15.49, d, 'bank'));
    // The statement posts a day later and spells it its own way.
    const statement = dates.map((d, i) => charge(`stmt${i}`, `CB NETFLIX.COM ${d.slice(8, 10)}/${d.slice(5, 7)}`, 15.49, addDays(d, 1), 'import'));
    // The receipt arrives the day before the bank posts it.
    const receipts = dates.map((d, i) =>
      mail({ id: `mail${i}`, kind: 'receipt', merchant: 'Netflix', senderDomain: 'account.netflix.com', amount: 15.49, currency: 'USD', cadence: 'monthly', dateISO: addDays(d, -1), chargedISO: addDays(d, -1) })
    );
    const r = run([...bank, ...statement], receipts);
    expect(r.res.upserts.map((u) => u.id)).toEqual(['sub_netflix']);
    expect(r.res.occurrences.map((o) => [o.subscriptionId, o.chargeId, o.dateISO, o.amount])).toEqual(
      dates.map((d, i) => ['sub_netflix', `bank${i}`, d, 15.49])
    );
    const netflix = r.one('netflix');
    expect([netflix.merchantDisplay, netflix.cadence, netflix.typicalAmount, netflix.sources, netflix.source]).toEqual([
      'Netflix',
      'monthly',
      15.49,
      'import,bank,email',
      'bank',
    ]);
    expect(r.res.events).toEqual([{ type: 'new', subscriptionId: 'sub_netflix' }]);
    quiet(r.again().res);
  });

  test("the bank's amount and date win over the email's copy of the same payment", () => {
    const dates = ['2026-07-14', '2026-08-14', '2026-09-14'];
    const r = run(
      series('b', NETFLIX, 15.49, dates),
      // The receipt shows the price with tax, a day early.
      dates.map((d, i) => mail({ id: `m${i}`, kind: 'receipt', merchant: 'Netflix', amount: 16.73, currency: 'USD', dateISO: addDays(d, -1), chargedISO: addDays(d, -1) }))
    );
    expect(r.one('netflix').typicalAmount).toBe(15.49);
    expect(r.res.occurrences.map((o) => [o.chargeId, o.dateISO, o.amount])).toEqual(dates.map((d, i) => [`b${i}`, d, 15.49]));
  });

  test('older rows for the same merchant fold into the one with a decision', () => {
    const existing = [
      row({ id: 'sub_netflix_com', merchantNormalized: 'NETFLIX COM', merchantDisplay: 'Netflix Com', typicalAmount: 15.49, lastChargedAt: '2026-07-14', createdAt: '2026-07-20T00:00:00Z' }),
      row({ id: 'subemail_netflix', merchantNormalized: 'NETFLIX', merchantDisplay: 'Netflix', typicalAmount: 15.49, source: 'email', sources: 'email', status: 'confirmed', decision: 'keep', createdAt: '2026-08-01T00:00:00Z' }),
    ];
    const r = run(series('b', NETFLIX, 15.49, monthsOf(2026, 6, 4, 14)), [], existing);
    expect(r.res.merges).toEqual([{ fromId: 'sub_netflix_com', intoId: 'subemail_netflix' }]);
    const netflix = r.one('netflix');
    expect([netflix.id, netflix.decision, netflix.status, netflix.sources, netflix.lastChargedAt]).toEqual([
      'subemail_netflix',
      'keep',
      'confirmed',
      'transaction,bank,email',
      '2026-09-14',
    ]);
    // Without a decision, the oldest row is kept.
    const undecided = existing.map((e) => ({ ...e, decision: null, status: 'possible' as const }));
    expect(run(series('b', NETFLIX, 15.49, monthsOf(2026, 6, 4, 14)), [], undecided).res.merges).toEqual([
      { fromId: 'subemail_netflix', intoId: 'sub_netflix_com' },
    ]);
  });

  test('receipts seen first and bank charges later stay one payment a month', () => {
    const dates = ['2026-07-14', '2026-08-14', '2026-09-14'];
    const receipts = dates.map((d, i) => mail({ id: `m${i}`, kind: 'receipt', merchant: 'Netflix', amount: 15.49, currency: 'USD', cadence: 'monthly', dateISO: d, chargedISO: d }));
    const first = run([], receipts);
    expect(first.one('netflix').sources).toBe('email');
    expect(first.res.events).toEqual([{ type: 'new', subscriptionId: 'sub_netflix' }]);

    const second = first.again(series('b', NETFLIX, 15.49, dates.map((d) => addDays(d, 2))));
    expect(second.res.events).toEqual([]);
    expect(second.one('netflix').sources).toBe('bank,email');
    expect(second.res.occurrences.map((o) => o.chargeId)).toEqual(['b0', 'b1', 'b2']);
    quiet(second.again().res);
  });

  test('Netflix billed through PayPal is the same Netflix, and says where to cancel', () => {
    const r = run([
      ...series('d', NETFLIX, 15.49, ['2026-05-14', '2026-06-14']),
      ...series('p', 'PAYPAL *NETFLIX 4029357733', 15.49, ['2026-07-14', '2026-08-14', '2026-09-14']),
    ]);
    const netflix = r.one('netflix');
    expect([netflix.billedVia, netflix.cadence]).toEqual(['paypal', 'monthly']);
    expect(r.res.occurrences).toHaveLength(5);
  });
});

// ── The user's decision wins ─────────────────────────────────────────────────

describe('decision wins', () => {
  test('a kept subscription keeps its decision and status while its price and dates update', () => {
    const existing = [row({ id: 'sub_netflix', merchantNormalized: 'netflix', typicalAmount: 15.49, lastChargedAt: '2026-05-14', status: 'confirmed', decision: 'keep' })];
    const charges = [...series('a', NETFLIX, 15.49, monthsOf(2026, 4, 4, 14)), ...series('b', NETFLIX, 17.99, monthsOf(2026, 8, 2, 14))];
    const r = run(charges, [], existing);
    const n = r.one('netflix');
    expect([n.decision, n.status, n.typicalAmount, n.previousAmount, n.lastChargedAt, n.nextExpectedAt]).toEqual([
      'keep',
      'confirmed',
      17.99,
      15.49,
      '2026-09-14',
      '2026-10-14',
    ]);
    expect(r.res.events).toEqual([{ type: 'price_rise', subscriptionId: 'sub_netflix', from: 15.49, to: 17.99 }]);
    quiet(r.again().res);
  });

  test('a cancelled subscription stays cancelled, and each charge after cancelling raises one alert', () => {
    const existing = [
      row({ id: 'sub_gym', merchantNormalized: 'planet_fitness', typicalAmount: 24.99, lastChargedAt: '2026-07-17', status: 'canceled', decision: 'cancel', canceledAt: '2026-08-01' }),
    ];
    const charges = series('g', 'PLANET FITNESS #0412 CLUB FEES', 24.99, monthsOf(2026, 4, 6, 17));
    const r = run(charges, [], existing);
    const gym = r.one('planet_fitness');
    expect([gym.decision, gym.status, gym.canceledAt, gym.alert, gym.lastChargedAt, gym.nextExpectedAt]).toEqual([
      'cancel',
      'canceled',
      '2026-08-01',
      'charged_after_cancel',
      '2026-09-17',
      null,
    ]);
    expect(r.res.events).toEqual([
      { type: 'charged_after_cancel', subscriptionId: 'sub_gym', chargedAt: '2026-08-17', amount: 24.99 },
      { type: 'charged_after_cancel', subscriptionId: 'sub_gym', chargedAt: '2026-09-17', amount: 24.99 },
    ]);
    quiet(r.again().res);
    // One more charge: one more event, for that charge only.
    const later = r.again([charge('g6', 'PLANET FITNESS #0412 CLUB FEES', 24.99, '2026-10-17')], [], '2026-10-20');
    expect(later.res.events).toEqual([{ type: 'charged_after_cancel', subscriptionId: 'sub_gym', chargedAt: '2026-10-17', amount: 24.99 }]);
  });

  test('a dismissed merchant is never proposed again and raises no events, whatever arrives', () => {
    const existing = [row({ id: 'sub_spotify', merchantNormalized: 'spotify', typicalAmount: 10.99, lastChargedAt: '2026-06-22', status: 'dismissed', decision: 'dismiss' })];
    const charges = [
      ...series('a', 'CARD 4921 XXXX XXXX 1234 SPOTIFY P1A2B3C', 10.99, monthsOf(2026, 3, 5, 22)),
      ...series('b', 'Spotify USA 877-778-1161 NY', 11.99, monthsOf(2026, 8, 2, 22)),
    ];
    const email = [
      mail({ id: 't', kind: 'trial_ending', merchant: 'Spotify', amount: 11.99, dateISO: '2026-10-01', trialEndsISO: '2026-10-30' }),
      mail({ id: 'p', kind: 'price_change', merchant: 'Spotify', amount: 12.99, previousAmount: 11.99, dateISO: '2026-10-02', nextChargeISO: '2026-10-22' }),
    ];
    const r = run(charges, email, existing);
    expect(r.res.events).toEqual([]);
    const s = r.one('spotify');
    expect([s.id, s.decision, s.status, s.nextExpectedAt, s.lastChargedAt]).toEqual(['sub_spotify', 'dismiss', 'dismissed', null, '2026-09-22']);
    quiet(r.again().res);
  });

  test('a dismissed row under an older spelling still holds the merchant back', () => {
    const existing = [row({ id: 'sub_spotify_ab', merchantNormalized: 'SPOTIFY AB', typicalAmount: 10.99, status: 'dismissed', decision: 'dismiss' })];
    const r = run(series('s', 'Spotify USA', 10.99, monthsOf(2026, 5, 5, 22)), [], existing);
    expect(r.rows.map((x) => [x.id, x.merchantNormalized, x.status])).toEqual([['sub_spotify_ab', 'spotify', 'dismissed']]);
    expect(r.res.events).toEqual([]);
  });

  test('a row from before decisions keeps the status the user gave it, and its decision is never written', () => {
    const existing = [
      row({ id: 'sub_hulu', merchantNormalized: 'hulu', typicalAmount: 7.99, status: 'confirmed', decision: null, lastChargedAt: '2026-06-03' }),
      row({ id: 'sub_canal_plus', merchantNormalized: 'canal_plus', typicalAmount: 24.99, status: 'canceled', decision: null, lastChargedAt: '2026-06-09' }),
    ];
    const charges = [...series('h', 'HULU 877-8244858 CA', 7.99, monthsOf(2026, 4, 6, 3)), ...series('c', 'PRLV SEPA GROUPE CANAL+', 24.99, monthsOf(2026, 4, 6, 9), 'bank', 'EUR')];
    const r = run(charges, [], existing);
    const hulu = r.one('hulu');
    const canal = r.one('canal_plus');
    expect([hulu.status, hulu.decision, hulu.lastChargedAt]).toEqual(['confirmed', null, '2026-09-03']);
    expect([canal.status, canal.decision, canal.alert]).toEqual(['canceled', null, 'charged_after_cancel']);
  });

  test('a kept subscription the service says is cancelled stays kept, with no next charge', () => {
    const existing = [row({ id: 'sub_the_times', merchantNormalized: 'the_times', typicalAmount: 26, status: 'confirmed', decision: 'keep', lastChargedAt: '2026-08-08' })];
    const r = run(series('t', 'TIMES NEWSPAPERS LTD', 26, monthsOf(2026, 4, 5, 8), 'bank', 'GBP'), [mail({ id: 'c', kind: 'cancellation', merchant: 'The Times', dateISO: '2026-09-01' })], existing);
    const t = r.one('the_times');
    expect([t.decision, t.status, t.nextExpectedAt]).toEqual(['keep', 'confirmed', null]);
    expect(r.res.events).toEqual([]);
  });
});

// ── Email evidence ───────────────────────────────────────────────────────────

describe('email evidence', () => {
  const huluTrial = mail({ id: 'trial', kind: 'trial_ending', merchant: 'Hulu', senderDomain: 'hulumail.com', amount: 9.99, currency: 'USD', cadence: 'monthly', dateISO: '2026-10-10', trialEndsISO: '2026-10-20' });

  test('a trial-ending email makes a trial with its end date and the price after it', () => {
    const r = run([], [huluTrial]);
    const hulu = r.one('hulu');
    expect([hulu.status, hulu.trialEndsAt, hulu.nextExpectedAt, hulu.typicalAmount, hulu.cadence, hulu.alert, hulu.source]).toEqual([
      'trial',
      '2026-10-20',
      '2026-10-20',
      9.99,
      'monthly',
      'trial_ending',
      'email',
    ]);
    expect(r.res.events).toEqual([{ type: 'trial_found', subscriptionId: 'sub_hulu', trialEndsAt: '2026-10-20' }]);
    quiet(r.again().res);
  });

  test('a trial that converts becomes a paid subscription, and one that lapses ends', () => {
    const trial = run([], [huluTrial]);
    const paid = trial.again([charge('h1', 'HULU 877-8244858 CA', 9.99, '2026-10-20')], [], '2026-10-25');
    const hulu = paid.one('hulu');
    expect([hulu.status, hulu.trialEndsAt, hulu.lastChargedAt, hulu.nextExpectedAt, hulu.alert]).toEqual(['possible', '2026-10-20', '2026-10-20', '2026-11-20', null]);
    expect(paid.res.events).toEqual([]);

    // No charge, while the bank shows everything else into November.
    const lapsed = trial.again([charge('x', 'SUNRISE LAWN CARE', 45, '2026-11-04')], [], '2026-11-05');
    const gone = lapsed.one('hulu');
    expect([gone.status, gone.nextExpectedAt]).toEqual(['ended', null]);
    expect(lapsed.res.events).toEqual([{ type: 'ended', subscriptionId: 'sub_hulu' }]);
  });

  test('a price-change email updates the price ahead of the charge, and the rise is announced once', () => {
    const charges = series('n', NETFLIX, 15.49, monthsOf(2026, 5, 5, 14));
    const before = run(charges);
    const notice = mail({ id: 'pc', kind: 'price_change', merchant: 'Netflix', amount: 17.99, previousAmount: 15.49, currency: 'USD', dateISO: '2026-09-20', nextChargeISO: '2026-10-14' });
    const r = before.again([], [notice], '2026-09-21');
    const n = r.one('netflix');
    expect([n.typicalAmount, n.previousAmount, n.priceChangedAt, n.alert, n.nextExpectedAt]).toEqual([17.99, 15.49, '2026-10-14', 'price_rise', '2026-10-14']);
    expect(r.res.events).toEqual([{ type: 'price_rise', subscriptionId: 'sub_netflix', from: 15.49, to: 17.99 }]);
    // The charge at the new price arrives: nothing new to say.
    const charged = r.again([charge('n5', NETFLIX, 17.99, '2026-10-14')], [], '2026-10-16');
    expect(charged.res.events).toEqual([]);
    const after = charged.one('netflix');
    expect([after.typicalAmount, after.previousAmount, after.priceChangedAt]).toEqual([17.99, 15.49, '2026-10-14']);
  });

  test('a renewal email sets the next charge date it states', () => {
    const charges = series('a', 'ADOBE *CREATIVE CLD 800-833-6687 CA', 54.99, monthsOf(2026, 5, 5, 5));
    expect(run(charges).one('adobe').nextExpectedAt).toBe('2026-10-05');
    const renewal = mail({ id: 'r', kind: 'renewal', merchant: 'Adobe', senderDomain: 'mail.adobe.com', amount: 54.99, currency: 'USD', cadence: 'monthly', dateISO: '2026-09-25', nextChargeISO: '2026-10-02' });
    expect(run(charges, [renewal], [], '2026-09-26').one('adobe').nextExpectedAt).toBe('2026-10-02');
  });

  test('a yearly renewal notice alone is a possible subscription', () => {
    const notice = mail({ id: 'r', kind: 'renewal', merchant: 'Acme Cloud Backup', senderDomain: 'billing.acmebackup.com', amount: 59, currency: 'EUR', cadence: 'yearly', dateISO: '2026-10-01', nextChargeISO: '2026-10-15' });
    const r = run([], [notice]);
    expect(r.rows.map((x) => [x.merchantNormalized, x.status, x.cadence, x.typicalAmount, x.currency, x.nextExpectedAt, x.lastChargedAt])).toEqual([
      ['acme_cloud_backup', 'possible', 'yearly', 59, 'EUR', '2026-10-15', null],
    ]);
  });

  test('a cancellation email never creates a subscription', () => {
    const peacock = series('p', 'PEACOCKTV 8YH2KD4 NY', 5.99, monthsOf(2026, 4, 5, 26));
    const cancel = mail({ id: 'c', kind: 'cancellation', merchant: 'Peacock', senderDomain: 'peacocktv.com', dateISO: '2026-09-02' });
    expect(run(peacock, [cancel]).rows).toEqual([]);
    expect(run([], [cancel]).rows).toEqual([]);
    // Charged again after the cancellation: they came back, and it is proposed.
    const back = run([...peacock, charge('p9', 'PEACOCKTV 8YH2KD4 NY', 5.99, '2026-09-26')], [cancel]);
    expect(back.one('peacock').status).toBe('active');
  });

  test('a cancellation email ends an undecided subscription, once', () => {
    const existing = [row({ id: 'sub_the_times', merchantNormalized: 'the_times', typicalAmount: 26, currency: 'GBP', status: 'active', lastChargedAt: '2026-08-08', nextExpectedAt: '2026-09-08' })];
    const r = run(series('t', 'TIMES NEWSPAPERS LTD', 26, monthsOf(2026, 4, 5, 8), 'bank', 'GBP'), [mail({ id: 'c', kind: 'cancellation', merchant: 'The Times', dateISO: '2026-09-01' })], existing, '2026-09-03');
    const t = r.one('the_times');
    expect([t.status, t.nextExpectedAt, t.sources]).toEqual(['ended', null, 'transaction,bank,email']);
    expect(r.res.events).toEqual([{ type: 'ended', subscriptionId: 'sub_the_times' }]);
    quiet(r.again().res);
  });

  test('an email that names only its sender still finds its merchant', () => {
    const dates = monthsOf(2026, 7, 3, 14);
    const r = run(
      series('b', NETFLIX, 15.49, dates),
      dates.map((d, i) => mail({ id: `m${i}`, kind: 'receipt', senderDomain: 'mailer.netflix.com', amount: 15.49, currency: 'USD', dateISO: d, chargedISO: d }))
    );
    expect(r.rows.map((x) => [x.merchantNormalized, x.sources])).toEqual([['netflix', 'bank,email']]);
  });
});

// ── Cadence ──────────────────────────────────────────────────────────────────

describe('cadence', () => {
  const only = (charges: SourceCharge[], today = '2026-10-12') => {
    const r = run(charges, [], [], today);
    expect(r.rows).toHaveLength(1);
    return r.rows[0]!;
  };

  test('weekly cadence', () => {
    const s = only(series('w', 'GREENLEAF VEG BOX', 18.5, everyDays('2026-08-31', 6, 7)));
    expect([s.cadence, s.nextExpectedAt, s.status]).toEqual(['weekly', '2026-10-12', 'active']);
  });

  test('biweekly cadence', () => {
    const s = only(series('h', 'HELLOFRESH*BOX 7781', 59.99, everyDays('2026-07-02', 8, 14)));
    expect([s.merchantNormalized, s.cadence, s.nextExpectedAt]).toEqual(['hellofresh', 'biweekly', '2026-10-22']);
  });

  test('monthly cadence, and a month-end plan stays at month end', () => {
    const s = only(series('m', 'SUNRISE LAWN CARE LLC', 45, ['2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30']));
    expect([s.cadence, s.nextExpectedAt]).toEqual(['monthly', '2026-10-31']);
    const feb = only(series('f', 'SUNRISE LAWN CARE LLC', 45, ['2025-12-31', '2026-01-31', '2026-02-28']), '2026-03-10');
    expect(feb.nextExpectedAt).toBe('2026-03-31');
  });

  test('quarterly cadence', () => {
    const s = only(series('e', 'ECONOMIST NEWSPAPER LTD', 52.5, ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-09'], 'bank', 'GBP'));
    expect([s.merchantDisplay, s.cadence, s.nextExpectedAt]).toEqual(['The Economist', 'quarterly', '2027-01-09']);
  });

  test('semiannual cadence', () => {
    const s = only(series('v', 'NORDVPN.COM', 71.88, ['2025-04-10', '2025-10-10', '2026-04-10']), '2026-10-01');
    expect([s.merchantNormalized, s.cadence, s.nextExpectedAt]).toEqual(['nordvpn', 'semiannual', '2026-10-10']);
  });

  test('yearly cadence', () => {
    const s = only(series('y', 'Amazon Prime*2K4L83', 139, ['2024-11-02', '2025-11-02']), '2026-10-01');
    expect([s.merchantNormalized, s.cadence, s.nextExpectedAt]).toEqual(['amazon_prime', 'yearly', '2026-11-02']);
  });

  test('an irregular cadence is not a subscription', () => {
    const dates = ['2026-03-02', '2026-03-05', '2026-03-24', '2026-05-10', '2026-05-18', '2026-06-20', '2026-08-30'];
    expect(run(series('i', 'CORNER HARDWARE', 40, dates)).rows).toEqual([]);
    // Nor is a known service charged at random.
    expect(run(series('k', NETFLIX, 15.49, dates)).rows).toEqual([]);
  });

  test('a four-weekly cadence stays on four weeks, and a skipped month keeps the cadence', () => {
    const fit = only(series('b', 'PRLV SEPA BASIC FIT FRANCE SAS', 29.99, everyDays('2026-05-05', 5, 28), 'bank', 'EUR'));
    expect([fit.cadence, fit.lastChargedAt, fit.nextExpectedAt]).toEqual(['monthly', '2026-08-25', '2026-09-22']);
    const gap = only(series('g', 'SUNRISE LAWN CARE LLC', 45, ['2026-04-01', '2026-05-01', '2026-07-01', '2026-08-01', '2026-09-01']));
    expect([gap.cadence, gap.nextExpectedAt]).toEqual(['monthly', '2026-10-01']);
  });

  test('monthly cost counts every cadence', () => {
    const cost = monthlyCost([
      { cadence: 'weekly', typicalAmount: 7 },
      { cadence: 'biweekly', typicalAmount: 14 },
      { cadence: 'monthly', typicalAmount: 10 },
      { cadence: 'quarterly', typicalAmount: 30 },
      { cadence: 'semiannual', typicalAmount: 60 },
      { cadence: 'yearly', typicalAmount: 120 },
      { cadence: 'unknown', typicalAmount: 999 },
    ]);
    expect(cost).toBeCloseTo((7 * 365) / 12 / 7 + (14 * 365) / 12 / 14 + 10 + 10 + 10 + 10, 10);
  });
});

// ── The old bugs stay fixed ──────────────────────────────────────────────────

describe('engine regression', () => {
  test('freeze: a subscription the user kept keeps updating after the first run', () => {
    const first = run(series('a', 'Spotify USA', 11.99, monthsOf(2026, 4, 3, 22)), [], [], '2026-06-25');
    const kept = first.rows.map((r) => ({ ...r, decision: 'keep' as const, status: 'confirmed' as const }));
    const later = run(series('a', 'Spotify USA', 11.99, monthsOf(2026, 4, 6, 22)), [], kept, '2026-09-25');
    const s = later.one('spotify');
    expect([s.status, s.lastChargedAt, s.nextExpectedAt, s.confidenceScore >= first.rows[0]!.confidenceScore]).toEqual([
      'confirmed',
      '2026-09-22',
      '2026-10-22',
      true,
    ]);
    expect(later.res.occurrences).toHaveLength(6);
  });

  test('price rise: the new price replaces the old one, which is kept, and the rise is announced once', () => {
    const old = series('a', NETFLIX, 15.49, monthsOf(2026, 4, 4, 14));
    const first = run(old, [], [], '2026-08-01');
    expect(first.one('netflix').typicalAmount).toBe(15.49);
    // One charge at a new price is not a new price yet.
    const one = first.again([charge('b0', NETFLIX, 17.99, '2026-08-14')], [], '2026-08-20');
    expect(one.one('netflix').typicalAmount).toBe(15.49);
    expect(one.res.events).toEqual([]);
    // Two are.
    const two = one.again([charge('b1', NETFLIX, 17.99, '2026-09-14')], [], '2026-09-20');
    const n = two.one('netflix');
    expect([n.typicalAmount, n.previousAmount, n.priceChangedAt, n.alert]).toEqual([17.99, 15.49, '2026-08-14', 'price_rise']);
    expect(two.res.events).toEqual([{ type: 'price_rise', subscriptionId: 'sub_netflix', from: 15.49, to: 17.99 }]);
    quiet(two.again().res);
    // A stored average from the old engine is not "the old price": no rise is announced for it.
    const averaged = [row({ id: 'sub_netflix', merchantNormalized: 'NETFLIX', typicalAmount: 16.32, status: 'possible', lastChargedAt: '2026-09-14' })];
    const fromAverage = run([...old, charge('b0', NETFLIX, 17.99, '2026-08-14'), charge('b1', NETFLIX, 17.99, '2026-09-14')], [], averaged, '2026-09-20');
    expect(fromAverage.res.events).toEqual([]);
    expect(fromAverage.one('netflix').typicalAmount).toBe(17.99);
  });

  test('coffee: a daily habit is never a subscription, however regular', () => {
    const coffee: SourceCharge[] = [];
    for (let day = 0; day < 60; day++) {
      const d = addDays('2026-08-01', day);
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      coffee.push(charge(`c${day}`, `STARBUCKS STORE ${10000 + (day % 7)}`, 4.5 + (day % 5) * 0.55, d));
      coffee.push(charge(`f${day}`, 'CAFE DE FLORE PARIS', 3.2 + (day % 3) * 0.4, d, 'bank', 'EUR'));
    }
    // The same latte every Monday is still coffee.
    const mondays = series('mon', 'STARBUCKS STORE 08123', 5.25, everyDays('2026-06-01', 12, 7));
    const groceries = series('t', 'TRADER JOE S #552', 64.1, everyDays('2026-04-04', 20, 7));
    const r = run([...coffee, ...mondays, ...groceries]);
    expect(r.rows).toEqual([]);
    expect(r.res.occurrences).toEqual([]);
  });

  test('a long-dead subscription ends, but a statement that stops early does not end it', () => {
    const existing = [row({ id: 'sub_hulu', merchantNormalized: 'hulu', typicalAmount: 7.99, status: 'active', lastChargedAt: '2026-03-03', nextExpectedAt: '2026-04-03' })];
    const hulu = series('h', 'HULU 877-8244858 CA', 7.99, monthsOf(2026, 1, 3, 3));
    const elsewhere = series('l', 'SUNRISE LAWN CARE LLC', 45, monthsOf(2026, 1, 10, 1));
    const r = run([...hulu, ...elsewhere], [], existing);
    const h = r.one('hulu');
    expect([h.status, h.nextExpectedAt]).toEqual(['ended', null]);
    expect(r.res.events.filter((e) => e.subscriptionId === 'sub_hulu')).toEqual([{ type: 'ended', subscriptionId: 'sub_hulu' }]);
    quiet(r.again().res);
    // A statement covering January to April only cannot say Hulu stopped.
    const statement = [...series('h', 'HULU 877-8244858 CA', 7.99, monthsOf(2026, 1, 3, 3), 'import'), charge('x', 'SUNRISE LAWN CARE LLC', 45, '2026-04-02', 'import')];
    expect(run(statement, [], existing).one('hulu').status).toBe('active');
    // And one found already dead in an old statement is not news.
    expect(run([...hulu, ...elsewhere]).rows.map((x) => x.merchantNormalized)).toEqual(['sunrise_lawn_care']);
  });

  test('charged after cancel: the alert is raised for the charge, not again for the same charge', () => {
    const existing = [row({ id: 'sub_gym', merchantNormalized: 'puregym', typicalAmount: 24.99, currency: 'GBP', lastChargedAt: '2026-07-01', status: 'canceled', decision: 'cancel', canceledAt: '2026-07-20' })];
    const charges = series('g', 'PUREGYM LTD 0123', 24.99, monthsOf(2026, 3, 7, 1), 'bank', 'GBP');
    const r = run(charges, [], existing);
    expect(r.one('puregym').alert).toBe('charged_after_cancel');
    expect(r.res.events.map((e) => [e.type, 'chargedAt' in e ? e.chargedAt : null])).toEqual([
      ['charged_after_cancel', '2026-08-01'],
      ['charged_after_cancel', '2026-09-01'],
    ]);
    quiet(r.again().res);
    // Charges that all came before the cancellation raise nothing.
    expect(run(series('g', 'PUREGYM LTD 0123', 24.99, monthsOf(2026, 3, 5, 1), 'bank', 'GBP'), [], existing).res.events).toEqual([]);
  });

  test('a quiet re-run: the same input twice writes nothing and says nothing', () => {
    const charges = [
      ...series('n', NETFLIX, 15.49, monthsOf(2026, 4, 4, 14)),
      ...series('n2', NETFLIX, 17.99, monthsOf(2026, 8, 2, 14)),
      ...series('s', 'PRLV SEPA FREE MOBILE REF:FM100234 ICS FR12ZZZ456789', 19.99, monthsOf(2026, 4, 6, 5), 'bank', 'EUR'),
      ...series('h', 'HELLOFRESH*BOX 7781', 59.99, everyDays('2026-07-02', 8, 14)),
      ...series('o', 'Online Transfer to SAV ...4417', 200, monthsOf(2026, 4, 6, 5)),
    ];
    const email = [mail({ id: 't', kind: 'trial_ending', merchant: 'Hulu', amount: 9.99, cadence: 'monthly', dateISO: '2026-10-08', trialEndsISO: '2026-10-15' })];
    const existing = [row({ id: 'sub_gym', merchantNormalized: 'planet_fitness', status: 'canceled', decision: 'cancel', canceledAt: '2026-05-01' })];
    const first = run(charges, email, existing);
    expect(first.res.events.length).toBeGreaterThan(0);
    quiet(first.again().res);
    quiet(first.again().again().res);
  });

  test('transfers, refunds, cash, fees, tax and loans are never proposed', () => {
    const months = monthsOf(2026, 3, 7, 1);
    const r = run([
      ...series('rent', 'Zelle payment to MIKE LANDLORD JPM99B7X2Q1L', 1650, months),
      ...series('vir', 'VIR SEPA EMIS VERS M DUPONT LOYER', 850, months, 'bank', 'EUR'),
      ...series('sav', 'Online Transfer to SAV ...4417', 200, months),
      ...series('so', 'J SMITH RENT       STO', 950, months, 'import', 'GBP'),
      ...series('atm', 'RETRAIT DAB PARIS 9', 60, months, 'bank', 'EUR'),
      ...series('fee', 'FRAIS TENUE DE COMPTE', 25, months, 'bank', 'MAD'),
      ...series('loan', 'ECHEANCE PRET IMMO 0012345', 1180, months, 'bank', 'EUR'),
      ...series('tax', 'PRLV SEPA DGFIP IMPOT PRELEVEMENT A LA SOURCE', 212, months, 'bank', 'EUR'),
      ...series('cc', 'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224', 500, months),
      ...series('ref', 'REFUND NETFLIX.COM', 15.49, months),
      ...series('alipay', '张*三', 2000, months, 'import', 'CNY'),
    ]);
    expect(r.rows).toEqual([]);
  });

  test('billed in a new currency after a move: not a price rise', () => {
    const existing = [row({ id: 'sub_spotify', merchantNormalized: 'spotify', typicalAmount: 10.99, currency: 'EUR', status: 'active', lastChargedAt: '2026-07-22' })];
    const charges = [
      ...series('e', 'SPOTIFY AB', 10.99, monthsOf(2026, 4, 4, 22), 'bank', 'EUR'),
      ...series('u', 'Spotify USA', 11.99, monthsOf(2026, 8, 2, 22), 'bank', 'USD'),
    ];
    const r = run(charges, [], existing);
    const s = r.one('spotify');
    expect([s.typicalAmount, s.currency, s.previousAmount, s.priceChangedAt, s.alert]).toEqual([11.99, 'USD', null, null, null]);
    expect(r.res.events).toEqual([]);
  });

  test('without a usable today, the latest evidence stands in for it', () => {
    const res = reconcileSubscriptions({ charges: series('n', NETFLIX, 15.49, monthsOf(2026, 6, 4, 14)), email: [], existing: [], today: 'not a date' });
    expect(res.upserts.map((u) => [u.merchantNormalized, u.status, u.nextExpectedAt])).toEqual([['netflix', 'active', '2026-10-14']]);
  });

  test('an unknown merchant needs three regular charges at a steady price; a known one needs two', () => {
    expect(run(series('u', 'SUNRISE LAWN CARE LLC', 45, monthsOf(2026, 8, 2, 1))).rows).toEqual([]);
    expect(run(series('u', 'SUNRISE LAWN CARE LLC', 45, monthsOf(2026, 7, 3, 1))).rows.map((x) => [x.merchantNormalized, x.status])).toEqual([
      ['sunrise_lawn_care', 'possible'],
    ]);
    const unsteady = monthsOf(2026, 4, 6, 1).map((d, i) => charge(`v${i}`, 'GREENLEAF CATERING', [42, 18.5, 77.25, 31, 64.4, 22][i]!, d));
    expect(run(unsteady).rows).toEqual([]);
    expect(run(series('k', NETFLIX, 15.49, monthsOf(2026, 8, 2, 14))).rows.map((x) => x.merchantNormalized)).toEqual(['netflix']);
  });
});
