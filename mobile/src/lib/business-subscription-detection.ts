/**
 * Recurring business expenses, for the business-mode screens.
 *
 * This used to be a third, independent detector — its own grouping, its own
 * cadence rules, its own cancel map — so the business dashboard and the
 * personal subscriptions screen could disagree about the same charges. It is
 * now an adapter over the shared engine, and its cancel map has been merged
 * into lib/cancel-directory alongside the consumer services.
 */
import { type Expense } from './expenseApi';
import { detectSubscriptions as detectFromEngine, monthlyCost } from './subscriptions/engine';
import { chargesFromExpenses } from './subscriptions/sources';
import { findCancelEntry } from './cancel-directory';
import { todayISO, daysAheadISO, daysBetween, isBetween } from './dates';
import { t } from './i18n/core';

export interface DetectedSubscription {
  key: string;
  name: string;
  amount: number;
  category: string;
  lastChargeDate: string;
  nextChargeDate: string;
  isRecurring: boolean;
  monthlyCount: number;
  cancelInstructions: string;
  cancelUrl?: string;
}

export interface SubscriptionSummary {
  monthlyTotal: number;
  annualTotal: number;
  subscriptions: DetectedSubscription[];
  upcoming: DetectedSubscription[];
}

/**
 * Resolved on call, not at module scope. A `t()` at import time freezes the
 * language the app happened to start in — see the guard in i18n.test.ts.
 */
const genericCancelSteps = () => t('subscriptionDetail.genericCancelSteps');

/** Cancel guidance for a merchant, from the shared directory. */
export function cancelGuidanceFor(merchant: string): { instructions: string; url?: string } {
  const entry = findCancelEntry(merchant.toLowerCase());
  if (!entry) return { instructions: genericCancelSteps() };
  return {
    instructions: entry.steps.join(' → '),
    url: entry.cancelUrl || undefined,
  };
}

type Detection = ReturnType<typeof detectFromEngine>[number];

function toDetected(s: Detection): DetectedSubscription {
  const cancel = cancelGuidanceFor(s.merchantNormalized);
  return {
    key: s.id,
    name: s.merchantDisplay,
    amount: s.typicalAmount,
    category: s.category,
    lastChargeDate: s.lastChargedAt,
    nextChargeDate: s.nextExpectedAt,
    isRecurring: s.cadence !== 'unknown',
    monthlyCount: s.occurrences.length,
    cancelInstructions: cancel.instructions,
    cancelUrl: cancel.url,
  };
}

/** Next charge from today to 30 days ahead, soonest first. Compared as calendar dates. */
function dueWithin30Days(subs: DetectedSubscription[], now: Date): DetectedSubscription[] {
  const today = todayISO(now);
  const horizon = daysAheadISO(30, now);
  return subs
    .filter((s) => isBetween(s.nextChargeDate.slice(0, 10), today, horizon))
    .sort((a, b) => a.nextChargeDate.localeCompare(b.nextChargeDate));
}

export function detectSubscriptions(
  expenses: Expense[],
  now: Date = new Date()
): SubscriptionSummary {
  const detections = detectFromEngine(chargesFromExpenses(expenses));
  const subscriptions = detections.map(toDetected);
  const monthlyTotal = monthlyCost(detections);

  return {
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    subscriptions,
    upcoming: dueWithin30Days(subscriptions, now),
  };
}

/** Business Tools: everything it lists, and what each costs a month. */
export interface ToolsOverview {
  /** Expense-detected tools and those found only in email, largest charge first (as the list shows them). */
  tools: DetectedSubscription[];
  /**
   * Each tool's cost per month, by key. A tool's `amount` is one charge, so a
   * yearly charge is a twelfth of it here and a weekly one 365/12/7 times it;
   * a tool with no regular cadence costs nothing a month.
   */
  monthlyByKey: Record<string, number>;
  monthlyTotal: number;
  /** Next charge from today to 30 days ahead, soonest first. */
  upcoming: DetectedSubscription[];
}

/**
 * The Business Tools screen's figures, from the expenses and the tools the
 * email scan found.
 *
 * The screen used to add up every tool's `amount`, which is one charge, so a
 * tool billed 120 a year counted as 120 a month in the monthly spend. Email
 * tools arrive already per month (emailSubToDetected normalises them), so
 * their amount is their monthly cost. A tool found both ways is counted once,
 * as the expense-detected one.
 */
export function toolsOverview(
  expenses: Expense[],
  fromEmail: DetectedSubscription[],
  now: Date = new Date()
): ToolsOverview {
  const detections = detectFromEngine(chargesFromExpenses(expenses));
  const fromExpenses = detections.map(toDetected);
  const monthlyByKey: Record<string, number> = {};
  for (const d of detections) monthlyByKey[d.id] = monthlyCost([d]);

  const known = new Set(fromExpenses.map((s) => s.name.toLowerCase()));
  const emailOnly = fromEmail.filter((s) => !known.has(s.name.toLowerCase()));
  for (const s of emailOnly) monthlyByKey[s.key] = s.amount;

  const tools = [...fromExpenses, ...emailOnly].sort((a, b) => b.amount - a.amount);

  return {
    tools,
    monthlyByKey,
    monthlyTotal: tools.reduce((sum, s) => sum + (monthlyByKey[s.key] ?? 0), 0),
    upcoming: dueWithin30Days(tools, now),
  };
}

// ─── Format helpers ─────────────────────────────────────────────────────────

export function formatNextCharge(dateStr: string, now: Date = new Date()): string {
  // Compared as calendar dates: parsing with `new Date()` and differencing
  // timestamps made "Today" flip to "Overdue" partway through the day
  // depending on the device's timezone.
  const diffDays = daysBetween(todayISO(now), dateStr.slice(0, 10));

  if (diffDays < 0) return t('subStatus.overdue');
  if (diffDays === 0) return t('subStatus.today');
  if (diffDays === 1) return t('subStatus.tomorrow');
  if (diffDays <= 7) return t('subStatus.inDays', { count: diffDays });

  return new Date(dateStr.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
