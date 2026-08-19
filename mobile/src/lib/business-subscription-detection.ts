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

const GENERIC_CANCEL_STEPS =
  'Visit the service\'s account or billing settings page and select "Cancel", "Downgrade", or "End subscription".';

/** Cancel guidance for a merchant, from the shared directory. */
export function cancelGuidanceFor(merchant: string): { instructions: string; url?: string } {
  const entry = findCancelEntry(merchant.toLowerCase());
  if (!entry) return { instructions: GENERIC_CANCEL_STEPS };
  return {
    instructions: entry.steps.join(' → '),
    url: entry.cancelUrl || undefined,
  };
}

export function detectSubscriptions(expenses: Expense[]): SubscriptionSummary {
  const detections = detectFromEngine(chargesFromExpenses(expenses));

  const subscriptions: DetectedSubscription[] = detections.map((s) => {
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
  });

  const monthlyTotal = monthlyCost(detections);
  const horizon = daysAheadISO(30);
  const upcoming = subscriptions
    .filter((s) => isBetween(s.nextChargeDate, todayISO(), horizon))
    .sort((a, b) => a.nextChargeDate.localeCompare(b.nextChargeDate));

  return {
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    subscriptions,
    upcoming,
  };
}

// ─── Format helpers ─────────────────────────────────────────────────────────

export function formatNextCharge(dateStr: string): string {
  // Compared as calendar dates: parsing with `new Date()` and differencing
  // timestamps made "Today" flip to "Overdue" partway through the day
  // depending on the device's timezone.
  const diffDays = daysBetween(todayISO(), dateStr.slice(0, 10));

  if (diffDays < 0) return 'Overdue';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `In ${diffDays} days`;

  return new Date(dateStr.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
