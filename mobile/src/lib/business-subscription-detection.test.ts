import { describe, test, expect } from 'bun:test';
import {
  cancelGuidanceFor,
  detectSubscriptions,
  formatNextCharge,
} from './business-subscription-detection';
import { findCancelEntry } from './cancel-directory';
import type { Expense, ExpenseCategory } from './expenseApi';
import { t } from './i18n/core';

// Saturday 15 August 2026, local noon.
const NOW = new Date(2026, 7, 15, 12, 0, 0);

let seq = 0;
function expense(
  description: string,
  amount: number,
  dateISO: string,
  category: ExpenseCategory = 'Software'
): Expense {
  seq += 1;
  const at = `${dateISO}T10:00:00.000Z`;
  return {
    id: `ex${seq}`,
    businessId: 'biz1',
    submitterId: 'u1',
    reviewerId: null,
    amount,
    category,
    description,
    imageUrl: null,
    status: 'approved',
    submittedAt: at,
    reviewedAt: null,
    createdAt: at,
    updatedAt: at,
    submitter: { id: 'u1', name: 'Sam', email: 'sam@example.test' },
    reviewer: null,
  };
}
const charges = (description: string, amount: number, dates: string[]) =>
  dates.map((d) => expense(description, amount, d));

/** Run `fn` with the process in `zone`, then put the previous zone back. */
function inTimeZone<T>(zone: string, fn: () => T): T {
  const previous = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = previous;
  }
}

describe('behaviour detection: business subscriptions', () => {
  test('three monthly charges are one recurring subscription with cancel guidance', () => {
    const adobe = findCancelEntry('adobe creative cloud')!;
    const summary = detectSubscriptions(
      charges('Adobe Creative Cloud', 54.99, ['2026-06-05', '2026-07-05', '2026-08-05']),
      NOW
    );
    const sub = {
      key: 'sub_adobe_creative_cloud',
      name: 'Adobe Creative Cloud',
      amount: 54.99,
      category: 'Software',
      lastChargeDate: '2026-08-05',
      nextChargeDate: '2026-09-05',
      isRecurring: true,
      monthlyCount: 3,
      cancelInstructions: adobe.steps.join(' → '),
      cancelUrl: adobe.cancelUrl,
    };
    expect(summary.subscriptions).toEqual([sub]);
    expect(summary.upcoming).toEqual([sub]);
    expect(summary.monthlyTotal).toBeCloseTo(54.99, 10);
    expect(summary.annualTotal).toBeCloseTo(659.88, 10);
  });

  test('upcoming is today to 30 days ahead, soonest first; the total is per month', () => {
    const summary = detectSubscriptions(
      [
        ...charges('Slack', 8.75, ['2026-06-20', '2026-07-20']), // next 20 Aug
        ...charges('Zoom', 15.99, ['2026-06-16', '2026-07-16']), // next 16 Aug
        ...charges('Figma', 12, ['2026-06-14', '2026-07-14']), // next 14 Aug: overdue
        ...charges('Linear', 8, ['2026-06-15', '2026-07-15']), // next 15 Aug: today
        ...charges('Dropbox', 11.99, ['2026-06-14', '2026-07-14', '2026-08-14']), // next 14 Sep: day 30
        ...charges('Notion', 120, ['2024-09-20', '2025-09-20']), // yearly, next 20 Sep: day 36
      ],
      NOW
    );
    expect(summary.upcoming.map((s) => [s.name, s.nextChargeDate])).toEqual([
      ['Linear', '2026-08-15'],
      ['Zoom', '2026-08-16'],
      ['Slack', '2026-08-20'],
      ['Dropbox', '2026-09-14'],
    ]);
    // Five monthly charges plus a twelfth of the yearly one.
    const monthly = 8.75 + 15.99 + 12 + 8 + 11.99 + 120 / 12;
    expect(summary.monthlyTotal).toBeCloseTo(monthly, 10);
    expect(summary.annualTotal).toBeCloseTo(monthly * 12, 10);
    expect(summary.subscriptions.map((s) => s.name)).toEqual([
      'Notion',
      'Zoom',
      'Figma',
      'Dropbox',
      'Slack',
      'Linear',
    ]);
  });

  test('a weekly charge counts 365/12/7 times a month', () => {
    const summary = detectSubscriptions(
      charges('Car Wash', 9, ['2026-07-25', '2026-08-01', '2026-08-08']),
      NOW
    );
    expect(summary.monthlyTotal).toBeCloseTo((9 * 365) / 12 / 7, 10);
    expect(summary.upcoming.map((s) => s.nextChargeDate)).toEqual(['2026-08-15']);
  });

  test('irregular charges need four occurrences, are not recurring and cost nothing a month', () => {
    const summary = detectSubscriptions(
      [
        ...charges('Office Depot', 40, ['2026-05-01', '2026-05-04', '2026-06-23', '2026-07-05']),
        ...charges('Staples', 40, ['2026-07-01', '2026-07-16']),
      ],
      NOW
    );
    expect(summary.subscriptions.map((s) => [s.name, s.isRecurring, s.monthlyCount])).toEqual([
      ['Office Depot', false, 4],
    ]);
    expect(summary.monthlyTotal).toBe(0);
    expect(summary.annualTotal).toBe(0);
    expect(summary.upcoming).toEqual([]);
    expect(detectSubscriptions([], NOW)).toEqual({
      monthlyTotal: 0,
      annualTotal: 0,
      subscriptions: [],
      upcoming: [],
    });
  });

  test('cancel guidance comes from the directory, or the generic steps', () => {
    const netflix = findCancelEntry('netflix')!;
    expect(cancelGuidanceFor('NETFLIX')).toEqual({
      instructions: netflix.steps.join(' → '),
      url: netflix.cancelUrl,
    });
    expect(cancelGuidanceFor('ZZYZX WIDGETS')).toEqual({
      instructions: t('subscriptionDetail.genericCancelSteps'),
    });
  });

  test('the next charge reads overdue, today, tomorrow, in N days, then a date', () => {
    const at = (d: string) => formatNextCharge(d, NOW);
    expect(at('2026-08-01')).toBe(t('subStatus.overdue'));
    expect(at('2026-08-14')).toBe(t('subStatus.overdue'));
    expect(at('2026-08-15')).toBe(t('subStatus.today'));
    expect(at('2026-08-16')).toBe(t('subStatus.tomorrow'));
    expect(at('2026-08-17')).toBe(t('subStatus.inDays', { count: 2 }));
    expect(at('2026-08-22')).toBe(t('subStatus.inDays', { count: 7 }));
    const later = at('2026-08-23');
    expect([
      t('subStatus.overdue'),
      t('subStatus.today'),
      t('subStatus.tomorrow'),
      t('subStatus.inDays', { count: 8 }),
    ]).not.toContain(later);
    expect(later).toContain('23');
    // A full timestamp is read by its date part.
    expect(at('2026-08-16T23:30:00.000Z')).toBe(t('subStatus.tomorrow'));
  });

  test('the next charge flips at local midnight, in every timezone', () => {
    for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
      inTimeZone(zone, () => {
        const lastMinute = new Date(2026, 7, 15, 23, 59);
        const firstMinute = new Date(2026, 7, 16, 0, 1);
        expect([zone, formatNextCharge('2026-08-15', lastMinute)]).toEqual([zone, t('subStatus.today')]);
        expect([zone, formatNextCharge('2026-08-15', firstMinute)]).toEqual([zone, t('subStatus.overdue')]);
        expect([zone, formatNextCharge('2026-08-16', firstMinute)]).toEqual([zone, t('subStatus.today')]);
      });
    }
  });
});
