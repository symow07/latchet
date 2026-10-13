import { afterEach, describe, expect, test } from 'bun:test';
import type { Subscription, SubscriptionOccurrence } from './db';
import { setLocale, t } from './i18n/core';
import {
  buildDetailView,
  buildSubscriptionsView,
  cadenceLabel,
  chargedAfterCancel,
  decisionChoices,
  formatMoney,
  monthlyTotalsByCurrency,
  needsDecision,
  priceRise,
  priceText,
  shortDate,
  sourceLabels,
  trialDaysLeft,
  undoTarget,
  whenLabel,
} from './subscription-view';

afterEach(() => setLocale('en'));

const TODAY = '2026-10-13';

const sub = (over: Partial<Subscription> & Pick<Subscription, 'id'>): Subscription => ({
  merchantDisplay: over.id.replace(/^sub_/, '').replace(/^\w/, (c) => c.toUpperCase()),
  merchantNormalized: over.id.replace(/^sub_/, ''),
  cadence: 'monthly',
  typicalAmount: 9.99,
  currency: 'USD',
  confidenceScore: 80,
  lastChargedAt: '2026-09-20',
  nextExpectedAt: '2026-10-20',
  status: 'active',
  cancelUrl: null,
  cancelNotes: null,
  source: 'bank',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  decision: null,
  canceledAt: null,
  trialEndsAt: null,
  previousAmount: null,
  priceChangedAt: null,
  alert: null,
  sources: 'bank',
  billedVia: null,
  ...over,
});

const opts = { today: TODAY, userCurrency: 'USD' };

describe('subscription view', () => {
  test('sections: upcoming charges with dates first, then active and kept, trials, to review, and ended or cancelled', () => {
    const subs = [
      sub({ id: 'sub_netflix', nextExpectedAt: '2026-10-15', typicalAmount: 15.49 }),
      sub({ id: 'sub_spotify', status: 'confirmed', decision: 'keep', nextExpectedAt: '2026-10-13' }),
      sub({ id: 'sub_adobe', cadence: 'yearly', typicalAmount: 239.88, nextExpectedAt: '2027-03-02' }),
      sub({ id: 'sub_canva', status: 'trial', trialEndsAt: '2026-10-20', nextExpectedAt: '2026-10-20', typicalAmount: 12.99 }),
      sub({ id: 'sub_gym', status: 'possible', confidenceScore: 45, nextExpectedAt: '2026-10-18' }),
      sub({ id: 'sub_hulu', status: 'ended', nextExpectedAt: null, lastChargedAt: '2026-05-02' }),
      sub({ id: 'sub_disney', status: 'canceled', decision: 'cancel', canceledAt: '2026-08-01', nextExpectedAt: null }),
      // "Not a subscription": hidden from every list, and from the totals.
      sub({ id: 'sub_coffee', status: 'dismissed', decision: 'dismiss', typicalAmount: 4.5 }),
    ];
    const v = buildSubscriptionsView(subs, opts);

    expect(v.upcoming.map((u) => [u.title, u.dateISO, u.when])).toEqual([
      ['Spotify', '2026-10-13', t('subsUi.when.today')],
      ['Netflix', '2026-10-15', t('subsUi.when.inDays', { count: 2 })],
      ['Canva', '2026-10-20', t('subsUi.when.inDays', { count: 7 })],
    ]);
    expect(v.upcoming[0]!.date).toBe('Oct 13');
    expect(v.upcoming[2]!.note).toBe(t('subsUi.list.trialEnds'));
    // A possible one is not counted as coming: it is not known to charge.
    expect(v.upcoming.some((u) => u.title === 'Gym')).toBe(false);

    expect(v.active.map((r) => r.title)).toEqual(['Spotify', 'Netflix', 'Adobe']);
    expect(v.active[0]!.meta).toBe([t('subsUi.status.confirmed'), t('subsUi.cadence.monthly'), t('subsUi.when.today')].join(' · '));
    expect(v.trials.map((r) => [r.title, r.meta])).toEqual([['Canva', t('subsUi.list.trialDaysLeft', { count: 7 })]]);
    expect(v.review.map((r) => r.title)).toEqual(['Gym']);
    expect(v.ended.map((r) => r.title)).toEqual(['Disney', 'Hulu']);
    expect(v.ended[0]!.meta).toBe(t('subsUi.list.cancelledOn', { date: 'Aug 1' }));
    expect([...v.active, ...v.trials, ...v.review, ...v.ended].some((r) => r.title === 'Coffee')).toBe(false);
    expect(v.runningCount).toBe(4);
    expect(v.empty).toBe(false);

    // Nothing but a dismissal: empty.
    expect(buildSubscriptionsView([subs[7]!], opts).empty).toBe(true);
  });

  test('alerts at the top: a charge after you cancelled, and a price that went up, with the old price', () => {
    const rose = sub({ id: 'sub_netflix', typicalAmount: 17.99, previousAmount: 15.49, priceChangedAt: '2026-10-01', alert: 'price_rise' });
    const announced = sub({ id: 'sub_spotify', typicalAmount: 12.99, previousAmount: 11.99, priceChangedAt: '2026-11-01', alert: 'price_rise' });
    const old = sub({ id: 'sub_hulu', typicalAmount: 18.99, previousAmount: 17.99, priceChangedAt: '2026-06-01', alert: 'price_rise' });
    const charged = sub({
      id: 'sub_disney',
      status: 'canceled',
      decision: 'cancel',
      canceledAt: '2026-09-01',
      lastChargedAt: '2026-10-02',
      typicalAmount: 13.99,
      nextExpectedAt: null,
      alert: 'charged_after_cancel',
    });
    const v = buildSubscriptionsView([rose, announced, old, charged], opts);
    expect(v.alerts.map((a) => [a.kind, a.title, a.body])).toEqual([
      ['charged_after_cancel', t('subsUi.alert.chargedAfterTitle', { name: 'Disney' }), t('subsUi.alert.chargedAfterBody', { amount: '$13.99', date: 'Oct 2' })],
      ['price_rise', t('subsUi.alert.priceRiseTitle', { name: 'Netflix' }), '$15.49 → $17.99, since Oct 1'],
      ['price_rise', t('subsUi.alert.priceRiseTitle', { name: 'Spotify' }), '$11.99 → $12.99, from Nov 1'],
    ]);

    // Cancelled again after that charge: dealt with. Kept after all: no longer "after you cancelled".
    expect(chargedAfterCancel({ ...charged, canceledAt: '2026-10-05' })).toBe(false);
    expect(chargedAfterCancel({ ...charged, status: 'confirmed', decision: 'keep' })).toBe(false);
    // A rise is not news once two months old, nor for something over or dismissed, nor a fall.
    expect(priceRise(old, TODAY)).toBeNull();
    expect(priceRise({ ...rose, status: 'canceled', decision: 'cancel' }, TODAY)).toBeNull();
    expect(priceRise({ ...rose, status: 'dismissed', decision: 'dismiss' }, TODAY)).toBeNull();
    expect(priceRise({ ...rose, previousAmount: 19.99 }, TODAY)).toBeNull();
    expect(priceRise(rose, TODAY)).toEqual({ from: 15.49, to: 17.99, dateISO: '2026-10-01', upcoming: false });
  });

  test('monthly totals by currency: euros are never added to dollars, and the user’s currency comes first', () => {
    const subs = [
      sub({ id: 'sub_a', currency: 'EUR', typicalAmount: 10 }),
      sub({ id: 'sub_b', currency: 'EUR', typicalAmount: 120, cadence: 'yearly' }),
      sub({ id: 'sub_c', currency: 'USD', typicalAmount: 30, cadence: 'quarterly' }),
      sub({ id: 'sub_d', currency: 'USD', typicalAmount: 60, cadence: 'semiannual' }),
      sub({ id: 'sub_e', currency: 'GBP', typicalAmount: 7, cadence: 'biweekly', status: 'trial', trialEndsAt: '2026-10-30' }),
      // Not counted: still to review, over, dismissed, irregular.
      sub({ id: 'sub_f', currency: 'USD', typicalAmount: 99, status: 'possible' }),
      sub({ id: 'sub_g', currency: 'USD', typicalAmount: 99, status: 'ended' }),
      sub({ id: 'sub_h', currency: 'USD', typicalAmount: 99, status: 'dismissed', decision: 'dismiss' }),
      sub({ id: 'sub_i', currency: 'USD', typicalAmount: 99, cadence: 'unknown' }),
      // No currency stored: the user's.
      sub({ id: 'sub_j', currency: '', typicalAmount: 5 }),
    ];
    expect(monthlyTotalsByCurrency(subs, 'usd')).toEqual([
      { currency: 'USD', monthly: 25 },
      { currency: 'EUR', monthly: 20 },
      { currency: 'GBP', monthly: Math.round(7 * (365 / 12 / 14) * 100) / 100 },
    ]);
    // For a euro user the row with no currency is in euros, and euros lead.
    expect(buildSubscriptionsView(subs, { today: TODAY, userCurrency: 'EUR' }).totals.slice(0, 2)).toEqual([
      { currency: 'EUR', monthly: 25 },
      { currency: 'USD', monthly: 20 },
    ]);
    // Each row in its own currency.
    expect(formatMoney(9.99, 'EUR')).toBe('€9.99');
    setLocale('fr');
    expect(formatMoney(9.99, 'EUR')).toMatch(/^9,99\s€$/);
    setLocale('en');
    expect(formatMoney(5, 'XYZQ')).toBe('5.00 XYZQ');
  });

  test('decisions: Keep, I cancelled it and Not a subscription, each undoable, and delete is a dismissal', () => {
    const undecided = sub({ id: 'sub_netflix' });
    expect(needsDecision(undecided)).toBe(true);
    expect(decisionChoices(undecided)).toEqual(['keep', 'cancel', 'dismiss']);
    expect(needsDecision(sub({ id: 'sub_x', status: 'trial', trialEndsAt: '2026-10-20' }))).toBe(true);
    expect(needsDecision(sub({ id: 'sub_x', status: 'possible' }))).toBe(true);
    // Stopped by itself: nothing to ask.
    expect(needsDecision(sub({ id: 'sub_x', status: 'ended' }))).toBe(false);

    const kept = sub({ id: 'sub_netflix', status: 'confirmed', decision: 'keep' });
    expect(needsDecision(kept)).toBe(false);
    expect(decisionChoices(kept)).toEqual(['cancel', 'dismiss']);
    const cancelled = sub({ id: 'sub_netflix', status: 'canceled', decision: 'cancel', canceledAt: '2026-09-30' });
    expect(decisionChoices(cancelled)).toEqual(['keep', 'dismiss']);

    // Undo puts back exactly what was there, the day of an earlier cancellation included.
    expect(undoTarget(undecided)).toEqual({ decision: null, canceledAt: null });
    expect(undoTarget(kept)).toEqual({ decision: 'keep', canceledAt: null });
    expect(undoTarget(cancelled)).toEqual({ decision: 'cancel', canceledAt: '2026-09-30' });

    // The detail says where it stands; a dismissed one is never listed again.
    expect(buildDetailView(cancelled, [], opts).decided).toBe(t('subsUi.detail.state.cancel', { date: 'Sep 30, 2026' }));
    const dismissed = sub({ id: 'sub_netflix', status: 'dismissed', decision: 'dismiss' });
    expect(buildDetailView(dismissed, [], opts).decided).toBe(t('subsUi.detail.state.dismiss'));
    expect(buildDetailView(dismissed, [], opts).showCancelGuide).toBe(false);
    expect(buildSubscriptionsView([dismissed], opts).empty).toBe(true);
    expect(buildDetailView(undecided, [], opts).question?.title).toBe(t('subsUi.detail.question'));
    expect(buildDetailView(kept, [], opts).question).toBeNull();
  });

  test('a trial counts down the days it has left, never below zero, and says what it then costs', () => {
    expect(trialDaysLeft('2026-10-20', TODAY)).toBe(7);
    expect(trialDaysLeft('2026-10-13', TODAY)).toBe(0);
    expect(trialDaysLeft('2026-10-01', TODAY)).toBe(0);
    const trial = sub({ id: 'sub_canva', status: 'trial', trialEndsAt: '2026-10-14', nextExpectedAt: '2026-10-14', typicalAmount: 12.99 });
    const v = buildSubscriptionsView([trial, sub({ id: 'sub_last', status: 'trial', trialEndsAt: TODAY, nextExpectedAt: TODAY })], opts);
    expect(v.trials.map((r) => r.meta)).toEqual([t('subsUi.list.trialEndsToday'), t('subsUi.list.trialDaysLeft', { count: 1 })]);
    const d = buildDetailView(trial, [], opts);
    expect(d.question?.body).toBe(t('subsUi.detail.askTrial', { date: 'Oct 14', price: '$12.99 a month' }));
    expect(d.facts.map((f) => f.label)).toContain(t('subsUi.detail.fact.trialEnds'));
    // The trial's end is its next charge: said once, not twice.
    expect(d.facts.filter((f) => f.label === t('subsUi.detail.fact.nextCharge'))).toEqual([]);
  });

  test('the detail: price history, next charge, where it was found, and every charge once, newest first', () => {
    const s = sub({
      id: 'sub_netflix',
      typicalAmount: 17.99,
      previousAmount: 15.49,
      priceChangedAt: '2026-09-15',
      alert: 'price_rise',
      sources: 'email,bank',
      billedVia: 'apple',
    });
    const occ: SubscriptionOccurrence[] = [
      { id: 'o1', subscriptionId: 'sub_netflix', transactionId: 't1', chargedAt: '2026-08-15', amount: 15.49 },
      { id: 'o3', subscriptionId: 'sub_netflix', transactionId: null, chargedAt: '2026-10-15', amount: 17.99 },
      { id: 'o2', subscriptionId: 'sub_netflix', transactionId: 't2', chargedAt: '2026-09-15', amount: 17.99 },
      { id: 'o2', subscriptionId: 'sub_netflix', transactionId: 't2', chargedAt: '2026-09-15', amount: 17.99 },
    ];
    const d = buildDetailView(s, occ, opts);
    expect(d.price).toBe('$17.99 a month');
    expect(d.priceHistory).toEqual({ from: 15.49, to: 17.99, currency: 'USD', text: t('subsUi.detail.priceWentUp', { date: 'Sep 15, 2026' }) });
    expect(d.occurrences.map((o) => o.id)).toEqual(['o3', 'o2', 'o1']);
    expect(d.facts).toContainEqual({ label: t('subsUi.detail.fact.nextCharge'), value: `Oct 20, 2026 · ${t('subsUi.when.inDays', { count: 7 })}` });
    expect(d.facts).toContainEqual({ label: t('subsUi.detail.fact.billedVia'), value: t('subsUi.billedVia.apple') });
    expect(d.facts).toContainEqual({ label: t('subsUi.detail.fact.foundIn'), value: `${t('subsUi.source.bank')}, ${t('subsUi.source.email')}` });
    expect(sourceLabels({ sources: '', source: 'email' })).toEqual([t('subsUi.source.email')]);

    const charged = buildDetailView(
      sub({ id: 'sub_disney', status: 'canceled', decision: 'cancel', canceledAt: '2026-09-01', lastChargedAt: '2026-10-02', alert: 'charged_after_cancel', typicalAmount: 13.99 }),
      [],
      opts,
    );
    expect(charged.chargedAfterCancel).toBe(
      t('subsUi.detail.chargedAfterBody', { amount: '$13.99', date: 'Oct 2, 2026', cancelled: 'Sep 1, 2026', name: 'Disney' }),
    );
    // Charged again after cancelling: how to cancel is shown again.
    expect(charged.showCancelGuide).toBe(true);
  });

  test('every cadence has its own words in every language, the new ones included', () => {
    for (const lang of ['en', 'fr', 'zh', 'ar'] as const) {
      setLocale(lang);
      const labels = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'unknown'].map(cadenceLabel);
      expect(new Set(labels).size).toBe(7);
      expect(labels.some((l) => l.includes('subsUi'))).toBe(false);
    }
    setLocale('en');
    expect(cadenceLabel('quarterly')).toBe('Every three months');
    expect(cadenceLabel('fortnightly-ish')).toBe(cadenceLabel('unknown'));
    expect(priceText(30, 'USD', 'quarterly')).toBe('$30.00 every three months');
    expect(priceText(60, 'EUR', 'semiannual')).toBe('€60.00 every six months');
  });

  test('dates read as the calendar date written, in any timezone', () => {
    expect(shortDate('2026-01-01')).toBe('Jan 1');
    expect(shortDate('2026-12-31')).toBe('Dec 31');
    expect(whenLabel('2026-10-14', TODAY)).toBe(t('subsUi.when.tomorrow'));
    expect(whenLabel('2026-10-10', TODAY)).toBe(t('subsUi.when.expected', { date: 'Oct 10' }));
    setLocale('zh');
    expect(shortDate('2026-10-14')).toBe('10月14日');
  });
});
