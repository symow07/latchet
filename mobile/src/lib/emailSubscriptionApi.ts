import { todayISO } from './dates';
import type { Subscription } from './db';
import type { DetectedSubscription } from './business-subscription-detection';
import { cancelGuide, type CancelPlatform } from './cancel-directory';
import { monthlyFactor } from './subscriptions/cadence';
import { convertAmount } from './subscription-detection';

/**
 * Business Tools' view of the subscriptions found in email.
 *
 * Everything else that lived here — the forwarding status, the inbox list,
 * the per-item "import" — went with the Phase 5 email screen: the email
 * screen now reads lib/email-connections (I-EMAIL-API) and lib/email-screen,
 * and detection reads every finding itself after each email sync, so an email
 * receipt and the bank's charge for the same payment are one subscription.
 *
 * Business Tools finds a company's tools in its own expenses and adds the
 * ones only email has seen, from here. It shows one figure a month per tool,
 * in the business's currency, so a tool billed in another currency is
 * converted at the cached rates, and left out when no rate is known rather
 * than added at face value.
 */

/** Still something the business pays for: running, or found and not yet answered. */
const SHOWN: ReadonlySet<string> = new Set(['active', 'confirmed', 'trial', 'possible']);

/** Found in email (as its first source or any later one). */
export function seenInEmail(sub: Pick<Subscription, 'source' | 'sources'>): boolean {
  return (sub.sources || sub.source || '')
    .split(',')
    .map((s) => s.trim())
    .includes('email');
}

/**
 * One email-found subscription as Business Tools lists it: `amount` is its
 * cost per month in `currency` (null when it cannot be converted), the next
 * charge is the engine's (a trial's end for a trial), and the cancel steps
 * follow whoever bills it. Null when it has no next date to show.
 */
export function emailSubToDetected(
  sub: Subscription,
  o: { currency: string; rates: Readonly<Record<string, number>> | null; platform: CancelPlatform; charges?: number },
): DetectedSubscription | null {
  const next = (sub.status === 'trial' ? sub.trialEndsAt : null) ?? sub.nextExpectedAt ?? sub.trialEndsAt;
  if (!next) return null;
  const factor = monthlyFactor(sub.cadence);
  // An irregular charge has no monthly cost of its own: its amount stands for one month.
  const perMonth = (Number(sub.typicalAmount) || 0) * (factor || 1);
  const amount = convertAmount(perMonth, sub.currency || o.currency, o.currency, o.rates);
  if (amount === null) return null;
  const guide = cancelGuide({
    merchantKey: sub.merchantNormalized,
    name: sub.merchantDisplay,
    billedVia: sub.billedVia ?? null,
    platform: o.platform,
  });
  return {
    key: sub.id,
    name: sub.merchantDisplay,
    amount: Math.round(amount * 100) / 100,
    category: 'Software',
    lastChargeDate: sub.lastChargedAt ?? todayISO(),
    nextChargeDate: next.slice(0, 10),
    isRecurring: sub.cadence !== 'unknown',
    monthlyCount: Math.max(1, o.charges ?? 1),
    cancelInstructions: guide.steps.join(' → '),
    cancelUrl: sub.cancelUrl ?? guide.link?.url ?? undefined,
  };
}

const RATES_WAIT_MS = 3_000;

async function businessRates(): Promise<Record<string, number>> {
  const { bundledSnapshot, loadRates } = await import('./rates');
  const live = await Promise.race([
    loadRates()
      .then((s) => s.rates)
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), RATES_WAIT_MS)),
  ]);
  return { ...bundledSnapshot().rates, ...(live ?? {}) };
}

/**
 * Subscriptions found in email and still being paid for (not ended, not
 * cancelled, not "not a subscription"), mapped for Business Tools — which
 * finds the rest in the business's own expenses.
 */
export async function getEmailDetectedForBusiness(): Promise<DetectedSubscription[]> {
  const db = await import('./db');
  const all = await db.getSubscriptions();
  const found = all.filter((s) => SHOWN.has(s.status) && seenInEmail(s));
  if (found.length === 0) return [];
  const [settings, rates, platform] = await Promise.all([
    db.getSettings(),
    businessRates().catch(() => null),
    import('react-native').then((rn) => (rn.Platform.OS === 'ios' || rn.Platform.OS === 'android' ? rn.Platform.OS : 'web') as CancelPlatform),
  ]);
  const currency = (settings.currency || 'USD').toUpperCase();
  const out: DetectedSubscription[] = [];
  for (const s of found) {
    const charges = (await db.getSubscriptionOccurrences(s.id)).length;
    const d = emailSubToDetected(s, { currency, rates, platform, charges });
    if (d) out.push(d);
  }
  return out;
}
