import { describe, expect, test } from 'bun:test';
import {
  IOS_PENDING_LIMIT,
  ledgerKeyFor,
  parseLedger,
  permissionStep,
  planIsWorthNotifying,
  planSubscriptionReminders,
  recordInLedger,
  upcomingRenewal,
  type PlanInput,
  type ReminderSubscription,
} from './subscription-reminders';

const TODAY = '2026-10-12';
const EARLY = 7 * 60; // 07:00, before the 09:00 reminders
const LATE = 15 * 60; // 15:00, after them

const sub = (over: Partial<ReminderSubscription> & Pick<ReminderSubscription, 'id'>): ReminderSubscription => ({
  merchantDisplay: over.id,
  cadence: 'monthly',
  typicalAmount: 9.99,
  currency: 'EUR',
  status: 'active',
  nextExpectedAt: null,
  trialEndsAt: null,
  ...over,
});

const plan = (input: Partial<PlanInput> & Pick<PlanInput, 'subscriptions'>) =>
  planSubscriptionReminders({ today: TODAY, nowMinutes: EARLY, ...input });

describe('subscription reminders', () => {
  test('a few days before each renewal, a week before a yearly one, at nine in the morning', () => {
    const { scheduled } = plan({
      subscriptions: [
        sub({ id: 'sub_netflix', nextExpectedAt: '2026-10-20' }),
        sub({ id: 'sub_prime', cadence: 'yearly', typicalAmount: 69.9, nextExpectedAt: '2026-11-30' }),
        sub({ id: 'sub_gym', cadence: 'weekly', status: 'confirmed', nextExpectedAt: '2026-10-16' }),
      ],
    });
    expect(scheduled.map((r) => [r.subscriptionId, r.kind, r.fireDate, r.hour, r.minute, r.daysBefore, r.dueDate])).toEqual([
      ['sub_gym', 'renewal', '2026-10-15', 9, 0, 1, '2026-10-16'],
      ['sub_netflix', 'renewal', '2026-10-17', 9, 0, 3, '2026-10-20'],
      ['sub_prime', 'renewal', '2026-11-23', 9, 0, 7, '2026-11-30'],
    ]);
    // Deterministic identifiers: planning again replaces rather than adds.
    expect(scheduled[1]!.identifier).toBe('subs:renewal:sub_netflix:2026-10-20');
    expect(plan({ subscriptions: [sub({ id: 'sub_netflix', nextExpectedAt: '2026-10-20' })] }).scheduled[0]!.identifier).toBe(
      scheduled[1]!.identifier,
    );
  });

  test('before a free trial ends: two days before and the day before, and no separate renewal for that first charge', () => {
    const { scheduled } = plan({
      subscriptions: [
        sub({ id: 'sub_canva', status: 'trial', typicalAmount: 11.99, nextExpectedAt: '2026-10-25', trialEndsAt: '2026-10-25' }),
        // Kept through its trial: still warned before the first charge.
        sub({ id: 'sub_duo', status: 'confirmed', nextExpectedAt: '2026-10-20', trialEndsAt: '2026-10-20' }),
      ],
    });
    expect(scheduled.map((r) => [r.subscriptionId, r.kind, r.fireDate, r.daysBefore])).toEqual([
      ['sub_duo', 'trial_ending', '2026-10-18', 2],
      ['sub_duo', 'trial_ending', '2026-10-19', 1],
      ['sub_canva', 'trial_ending', '2026-10-23', 2],
      ['sub_canva', 'trial_ending', '2026-10-24', 1],
    ]);
    // A trial ending tomorrow, found this afternoon: the day-before reminder's morning is gone.
    const late = planSubscriptionReminders({
      today: TODAY,
      nowMinutes: LATE,
      subscriptions: [sub({ id: 'sub_x', status: 'trial', trialEndsAt: '2026-10-13', nextExpectedAt: '2026-10-13' })],
    });
    expect(late.scheduled).toEqual([]);
  });

  test('nothing for a dismissed, cancelled or ended subscription, nor a merely possible one', () => {
    const quiet = ['dismissed', 'canceled', 'ended', 'possible'].map((status, i) =>
      sub({ id: `sub_${status}`, status, nextExpectedAt: `2026-10-2${i}`, trialEndsAt: '2026-10-28' }),
    );
    const events = quiet.flatMap((s) => [
      { type: 'price_rise' as const, subscriptionId: s.id, from: 9.99, to: 12.99 },
      { type: 'new' as const, subscriptionId: s.id },
    ]);
    const result = plan({ subscriptions: quiet, events });
    expect(result.scheduled).toEqual([]);
    // A possible one may be announced as found ("did you forget?"), and its
    // price rise said; the silenced ones say nothing at all.
    expect(result.notices.map((n) => [n.kind, n.subscriptionIds])).toEqual([
      ['found', ['sub_possible']],
      ['price_rise', ['sub_canceled']],
      ['price_rise', ['sub_possible']],
    ]);
  });

  test('never in the past: found late, a renewal reminder moves to the next morning before the charge, or there is none', () => {
    const due = (nextExpectedAt: string, nowMinutes: number) =>
      planSubscriptionReminders({ today: TODAY, nowMinutes, subscriptions: [sub({ id: 'sub_a', nextExpectedAt })] }).scheduled.map(
        (r) => [r.fireDate, r.daysBefore],
      );
    // Due in two days, lead of three: tomorrow morning, or this morning if it is still early.
    expect(due('2026-10-14', LATE)).toEqual([['2026-10-13', 1]]);
    expect(due('2026-10-14', EARLY)).toEqual([['2026-10-12', 2]]);
    // Due tomorrow, at three in the afternoon: no morning left before it.
    expect(due('2026-10-13', LATE)).toEqual([]);
    // Due today: too late for this one.
    expect(due('2026-10-12', EARLY)).toEqual([]);
  });

  test('a renewal date already behind us steps forward by the plan’s own rhythm', () => {
    expect(upcomingRenewal('2026-08-31', 'monthly', TODAY)).toBe('2026-10-31');
    expect(upcomingRenewal('2026-01-31', 'monthly', '2026-02-10')).toBe('2026-02-28');
    expect(upcomingRenewal('2026-09-28', 'weekly', TODAY)).toBe('2026-10-12');
    expect(upcomingRenewal('2025-11-03', 'yearly', TODAY)).toBe('2026-11-03');
    expect(upcomingRenewal('2026-10-20', 'monthly', TODAY)).toBe('2026-10-20');
    // An irregular plan cannot be stepped: no guess.
    expect(upcomingRenewal('2026-09-01', 'unknown', TODAY)).toBeNull();
    expect(plan({ subscriptions: [sub({ id: 'sub_old', nextExpectedAt: '2026-09-01', cadence: 'unknown' })] }).scheduled).toEqual([]);
  });

  test('several finds are one notice; a price rise and a charge after cancelling are said at once; none twice', () => {
    const subs = [
      sub({ id: 'sub_netflix' }),
      sub({ id: 'sub_spotify' }),
      sub({ id: 'sub_canva', status: 'trial', trialEndsAt: '2026-10-25' }),
      sub({ id: 'sub_gym', status: 'confirmed' }),
      sub({ id: 'sub_old', status: 'canceled', typicalAmount: 4.99 }),
    ];
    const events = [
      { type: 'new' as const, subscriptionId: 'sub_netflix' },
      { type: 'new' as const, subscriptionId: 'sub_spotify' },
      { type: 'trial_found' as const, subscriptionId: 'sub_canva', trialEndsAt: '2026-10-25' },
      { type: 'price_rise' as const, subscriptionId: 'sub_gym', from: 29.99, to: 34.99 },
      { type: 'charged_after_cancel' as const, subscriptionId: 'sub_old', chargedAt: '2026-09-05', amount: 4.99 },
      { type: 'charged_after_cancel' as const, subscriptionId: 'sub_old', chargedAt: '2026-10-05', amount: 4.99 },
      { type: 'ended' as const, subscriptionId: 'sub_gym' },
    ];
    const first = plan({ subscriptions: subs, events });
    expect(first.notices.map((n) => n.kind)).toEqual(['found', 'price_rise', 'charged_after_cancel']);
    const [found, rise, again] = first.notices;
    expect(found).toMatchObject({ show: true, subscriptionIds: ['sub_netflix', 'sub_spotify', 'sub_canva'] });
    expect(found!.kind === 'found' && found!.items.map((i) => i.trialEndsAt)).toEqual([null, null, '2026-10-25']);
    expect(rise).toMatchObject({ from: 29.99, to: 34.99, ledgerKeys: ['price:sub_gym:34.99'] });
    // Two charges after cancelling: one notice, about the latest, recording both.
    expect(again).toMatchObject({ chargedAt: '2026-10-05', ledgerKeys: ['cac:sub_old:2026-09-05:4.99', 'cac:sub_old:2026-10-05:4.99'] });

    // The same events again, after the ledger recorded what was shown: nothing.
    const shown = first.notices.flatMap((n) => n.ledgerKeys);
    expect(plan({ subscriptions: subs, events, notified: shown }).notices).toEqual([]);
    // Only Netflix already announced: the others still are.
    const rest = plan({ subscriptions: subs, events: events.slice(0, 3), notified: [ledgerKeyFor(events[0]!)!] });
    expect(rest.notices[0]!.subscriptionIds).toEqual(['sub_spotify', 'sub_canva']);
  });

  test('finds the user is looking at are recorded but not shown', () => {
    const quiet = plan({
      subscriptions: [sub({ id: 'sub_netflix', status: 'possible' })],
      events: [{ type: 'new', subscriptionId: 'sub_netflix' }],
      announceFinds: false,
    });
    expect(quiet.notices).toHaveLength(1);
    expect(quiet.notices[0]).toMatchObject({ show: false, ledgerKeys: ['new:sub_netflix'] });
    expect(planIsWorthNotifying(quiet)).toBe(false);
  });

  test('within iOS’s 64 pending, shared with the app’s other notifications: the earliest first', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      sub({ id: `sub_${String(i).padStart(2, '0')}`, nextExpectedAt: `2026-${i < 40 ? '11' : '12'}-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    const full = plan({ subscriptions: many });
    expect(full.scheduled).toHaveLength(IOS_PENDING_LIMIT - 1);
    const tight = plan({ subscriptions: many, limit: 5 });
    expect(tight.scheduled).toHaveLength(5);
    const dates = tight.scheduled.map((r) => r.fireDate);
    expect(dates).toEqual([...dates].sort());
    expect(dates.every((d) => d <= full.scheduled[5]!.fireDate)).toBe(true);
    expect(plan({ subscriptions: many, limit: -3 }).scheduled).toEqual([]);
  });

  test('the ledger of notices shown keeps each once and forgets them after a while', () => {
    let ledger = recordInLedger({}, ['new:sub_a', 'price:sub_b:9.99'], '2025-10-01');
    ledger = recordInLedger(ledger, ['new:sub_c', 'new:sub_a'], TODAY);
    expect(ledger).toEqual({ 'new:sub_a': TODAY, 'new:sub_c': TODAY, 'price:sub_b:9.99': '2025-10-01' });
    // Over 400 days later the old entries go.
    expect(Object.keys(recordInLedger(ledger, [], '2026-11-10')).sort()).toEqual(['new:sub_a', 'new:sub_c']);
    expect(parseLedger(JSON.stringify(ledger))).toEqual(ledger);
    expect(parseLedger('not json')).toEqual({});
    expect(parseLedger('[1,2]')).toEqual({});
    expect(parseLedger(JSON.stringify({ a: 'yesterday', b: '2026-10-01' }))).toEqual({ b: '2026-10-01' });
  });
});

describe('permission when useful', () => {
  test('asked only when there is something worth a notification, and the OS can still ask', () => {
    expect(permissionStep({ status: 'undetermined', canAskAgain: true }, true)).toBe('ask');
    expect(permissionStep({ status: 'undetermined', canAskAgain: true }, false)).toBe('skip');
    expect(permissionStep({ status: 'undetermined' }, true)).toBe('ask');
    // Answered already: iOS shows no second prompt, so none is attempted.
    expect(permissionStep({ status: 'denied', canAskAgain: false }, true)).toBe('skip');
    expect(permissionStep({ status: 'undetermined', canAskAgain: false }, true)).toBe('skip');
    expect(permissionStep(null, true)).toBe('skip');
  });

  test('granted permission is used, worth it or not', () => {
    expect(permissionStep({ status: 'granted', canAskAgain: true }, false)).toBe('use');
    expect(permissionStep({ status: 'granted', canAskAgain: false }, true)).toBe('use');
  });

  test('a plan is worth asking over only when it has a reminder to hold or a notice to show', () => {
    expect(planIsWorthNotifying(plan({ subscriptions: [] }))).toBe(false);
    expect(planIsWorthNotifying(plan({ subscriptions: [sub({ id: 'sub_a', status: 'dismissed', nextExpectedAt: '2026-10-20' })] }))).toBe(false);
    expect(planIsWorthNotifying(plan({ subscriptions: [sub({ id: 'sub_a', nextExpectedAt: '2026-10-20' })] }))).toBe(true);
    expect(
      planIsWorthNotifying(plan({ subscriptions: [sub({ id: 'sub_a' })], events: [{ type: 'new', subscriptionId: 'sub_a' }] })),
    ).toBe(true);
  });
});
