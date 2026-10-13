/**
 * What the subscription screens show, worked out away from React.
 *
 * The list (subscriptions.tsx) leads with what makes the feature worth having:
 * the alerts (charged after you cancelled, a price that went up), the charges
 * coming in the next 30 days with their dates, then what is running, the
 * free trials with the days they have left, what Budget is not sure about
 * ("To review"), and at the end, folded away, what has ended or was
 * cancelled. A subscription the user said is not one (dismissed) is never
 * listed again.
 *
 * Money is shown in each subscription's own currency, and the monthly totals
 * are one per currency: euros are never added to dollars here.
 *
 * The detail (subscription-detail.tsx) is where every reminder lands: the
 * question "Keep it, or did you forget?" while the user has not decided, the
 * price history, the next charge, the trial's end, where it was found and
 * every charge behind it.
 *
 * Pure: dates are compared as YYYY-MM-DD strings, and nothing here touches
 * the database or React Native.
 */
import { getIntlTag, t } from './i18n/core';
import { addDaysISO, daysBetween, monthlyFactor } from './subscriptions/cadence';
import type { Subscription, SubscriptionDecision, SubscriptionOccurrence, SubscriptionStatus } from './db';

// ── Statuses ─────────────────────────────────────────────────────────────────

/** Running and charging: what the totals and the upcoming charges count. */
export const RUNNING_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['active', 'confirmed', 'trial']);
/** Over: listed at the end, folded away. */
export const OVER_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['ended', 'canceled']);

const CADENCES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'unknown'] as const;
type CadenceKey = (typeof CADENCES)[number];

function cadenceKey(cadence: string | null | undefined): CadenceKey {
  return (CADENCES as readonly string[]).includes(cadence ?? '') ? (cadence as CadenceKey) : 'unknown';
}

/** "Every three months" — every cadence the engine knows, in the reader's language. */
export function cadenceLabel(cadence: string | null | undefined): string {
  return t(`subsUi.cadence.${cadenceKey(cadence)}`);
}

export function statusLabel(status: SubscriptionStatus): string {
  return t(`subsUi.status.${status}`);
}

// ── Money and dates ──────────────────────────────────────────────────────────

const ISO_CURRENCY = /^[A-Z]{3}$/;

/** Its own currency, or the user's when the row has none. */
export function currencyOf(sub: { currency?: string | null }, fallback: string): string {
  const c = (sub.currency ?? '').trim().toUpperCase();
  return ISO_CURRENCY.test(c) ? c : (fallback || 'USD').toUpperCase();
}

/**
 * An amount in a given currency, in the reader's language: "$9.99", "9,99 €",
 * "CA$12.99". The symbol is the unambiguous one, so a list mixing dollars
 * says which dollars.
 */
export function formatMoney(amount: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase();
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(getIntlTag(), {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

const formatters = new Map<string, (n: number) => string>();

/**
 * One stable formatter per language and currency, for the kit's Amount (which
 * measures where the symbol goes once per formatter).
 */
export function moneyFormatter(currency: string): (n: number) => string {
  const key = `${getIntlTag()}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = (n: number) => formatMoney(n, currency);
    formatters.set(key, f);
  }
  return f;
}

/** "€9.99 a month", "$120.00 a year". */
export function priceText(amount: number, currency: string, cadence: string | null | undefined): string {
  return t(`subsUi.per.${cadenceKey(cadence)}`, { amount: formatMoney(amount, currency) });
}

function utcOf(dateISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO ?? '');
  if (!m) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
}

/** "Oct 14", "14 oct.", "10月14日", in the reader's language. The calendar date as written, in any timezone. */
export function shortDate(dateISO: string): string {
  const at = utcOf(dateISO);
  if (at === null) return dateISO;
  try {
    return new Intl.DateTimeFormat(getIntlTag(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(at);
  } catch {
    return dateISO.slice(0, 10);
  }
}

/** "Oct 14, 2026". */
export function longDate(dateISO: string): string {
  const at = utcOf(dateISO);
  if (at === null) return dateISO;
  try {
    return new Intl.DateTimeFormat(getIntlTag(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(at);
  } catch {
    return dateISO.slice(0, 10);
  }
}

/** When a coming charge lands: "Today", "Tomorrow", "In 5 days", or, if it is late, "Expected Oct 3". */
export function whenLabel(dateISO: string, today: string): string {
  const days = daysBetween(today, dateISO.slice(0, 10));
  if (days < 0) return t('subsUi.when.expected', { date: shortDate(dateISO) });
  if (days === 0) return t('subsUi.when.today');
  if (days === 1) return t('subsUi.when.tomorrow');
  return t('subsUi.when.inDays', { count: days });
}

/** Days until a trial converts (0 on its last day), never negative. */
export function trialDaysLeft(trialEndsAt: string, today: string): number {
  return Math.max(0, daysBetween(today, trialEndsAt.slice(0, 10)));
}

// ── The list ─────────────────────────────────────────────────────────────────

export interface SubscriptionRowView {
  sub: Subscription;
  title: string;
  meta: string;
  amount: number;
  currency: string;
}

export interface UpcomingView {
  sub: Subscription;
  dateISO: string;
  /** "Today", "In 3 days". */
  when: string;
  /** "Oct 17". */
  date: string;
  title: string;
  /** "Trial ends" when this charge is the first after a free trial. */
  note: string | null;
  amount: number;
  currency: string;
}

export type ListAlertKind = 'charged_after_cancel' | 'price_rise';

export interface ListAlertView {
  kind: ListAlertKind;
  sub: Subscription;
  title: string;
  body: string;
}

export interface MonthlyTotal {
  currency: string;
  monthly: number;
}

export interface SubscriptionsView {
  alerts: ListAlertView[];
  upcoming: UpcomingView[];
  active: SubscriptionRowView[];
  trials: SubscriptionRowView[];
  review: SubscriptionRowView[];
  ended: SubscriptionRowView[];
  /** What the running subscriptions cost a month, one figure per currency, the user's first. */
  totals: MonthlyTotal[];
  /** Running subscriptions (trials included). */
  runningCount: number;
  /** Nothing to show at all (dismissed ones do not count). */
  empty: boolean;
}

export interface ViewOptions {
  /** The user's local date, YYYY-MM-DD. */
  today: string;
  /** The user's currency: the first total, and the currency of a row that has none. */
  userCurrency: string;
  /** How far ahead "upcoming" looks. */
  horizonDays?: number;
  /** How long a price rise stays an alert at the top. */
  priceAlertDays?: number;
}

const UPCOMING_DAYS = 30;
const PRICE_ALERT_DAYS = 60;

/** Two prices within two cents are the same price. */
const samePrice = (a: number, b: number) => Math.abs(a - b) < 0.02;

/** Charged after the user said they cancelled: a charge dated after the day they cancelled. */
export function chargedAfterCancel(sub: Subscription): boolean {
  if (sub.status !== 'canceled' || sub.decision !== 'cancel') return false;
  if (sub.alert !== 'charged_after_cancel') return false;
  const last = sub.lastChargedAt?.slice(0, 10);
  const cancelled = sub.canceledAt?.slice(0, 10);
  // Cancelled again after that charge: the user has dealt with it.
  return !!last && (!cancelled || last > cancelled);
}

/**
 * A price that went up, still news: the rise took effect in the last two
 * months, or is announced for a coming date. Not for a subscription that is
 * over or dismissed.
 */
export function priceRise(sub: Subscription, today: string, withinDays = PRICE_ALERT_DAYS): { from: number; to: number; dateISO: string; upcoming: boolean } | null {
  if (sub.alert !== 'price_rise') return null;
  if (OVER_STATUSES.has(sub.status) || sub.status === 'dismissed') return null;
  const from = sub.previousAmount;
  const to = sub.typicalAmount;
  const at = sub.priceChangedAt?.slice(0, 10);
  if (from === null || from === undefined || !(from > 0) || !(to > from) || samePrice(from, to) || !at) return null;
  if (at < addDaysISO(today, -withinDays)) return null;
  return { from, to, dateISO: at, upcoming: at > today };
}

function nameOf(sub: Subscription): string {
  return (sub.merchantDisplay ?? '').trim() || sub.merchantNormalized || '?';
}

function rowMeta(sub: Subscription, today: string): string {
  const parts: string[] = [];
  switch (sub.status) {
    case 'trial': {
      if (sub.trialEndsAt) {
        const left = trialDaysLeft(sub.trialEndsAt, today);
        parts.push(left === 0 ? t('subsUi.list.trialEndsToday') : t('subsUi.list.trialDaysLeft', { count: left }));
      }
      break;
    }
    case 'possible':
      parts.push(cadenceLabel(sub.cadence));
      if (sub.lastChargedAt) parts.push(t('subsUi.list.lastCharged', { date: shortDate(sub.lastChargedAt) }));
      break;
    case 'canceled':
      parts.push(sub.canceledAt ? t('subsUi.list.cancelledOn', { date: shortDate(sub.canceledAt) }) : statusLabel('canceled'));
      break;
    case 'ended':
      parts.push(statusLabel('ended'));
      if (sub.lastChargedAt) parts.push(t('subsUi.list.lastCharged', { date: shortDate(sub.lastChargedAt) }));
      break;
    default:
      if (sub.status === 'confirmed') parts.push(statusLabel('confirmed'));
      parts.push(cadenceLabel(sub.cadence));
      if (sub.nextExpectedAt) parts.push(whenLabel(sub.nextExpectedAt, today));
  }
  return parts.join(' · ');
}

function rowOf(sub: Subscription, o: ViewOptions): SubscriptionRowView {
  return {
    sub,
    title: nameOf(sub),
    meta: rowMeta(sub, o.today),
    amount: Number(sub.typicalAmount) || 0,
    currency: currencyOf(sub, o.userCurrency),
  };
}

const byName = (a: Subscription, b: Subscription) => nameOf(a).localeCompare(nameOf(b));
const byNext = (a: Subscription, b: Subscription) =>
  (a.nextExpectedAt ?? '9999').localeCompare(b.nextExpectedAt ?? '9999') || byName(a, b);

/** What running subscriptions cost a month, per currency; the user's currency first, then the largest. */
export function monthlyTotalsByCurrency(subs: readonly Subscription[], userCurrency: string): MonthlyTotal[] {
  const sums = new Map<string, number>();
  for (const s of subs) {
    if (!RUNNING_STATUSES.has(s.status)) continue;
    const monthly = (Number(s.typicalAmount) || 0) * monthlyFactor(s.cadence);
    if (!(monthly > 0)) continue;
    const c = currencyOf(s, userCurrency);
    sums.set(c, (sums.get(c) ?? 0) + monthly);
  }
  const mine = (userCurrency || 'USD').toUpperCase();
  return [...sums.entries()]
    .map(([currency, monthly]) => ({ currency, monthly: Math.round(monthly * 100) / 100 }))
    .sort((a, b) => (a.currency === mine ? -1 : b.currency === mine ? 1 : b.monthly - a.monthly || a.currency.localeCompare(b.currency)));
}

export function buildSubscriptionsView(subs: readonly Subscription[], o: ViewOptions): SubscriptionsView {
  const today = o.today;
  const horizon = addDaysISO(today, o.horizonDays ?? UPCOMING_DAYS);
  const visible = subs.filter((s) => s.status !== 'dismissed');

  const alerts: ListAlertView[] = [];
  for (const s of visible) {
    const currency = currencyOf(s, o.userCurrency);
    if (chargedAfterCancel(s)) {
      alerts.push({
        kind: 'charged_after_cancel',
        sub: s,
        title: t('subsUi.alert.chargedAfterTitle', { name: nameOf(s) }),
        body: t('subsUi.alert.chargedAfterBody', {
          amount: formatMoney(s.typicalAmount, currency),
          date: shortDate(s.lastChargedAt!),
        }),
      });
      continue;
    }
    const rise = priceRise(s, today, o.priceAlertDays);
    if (rise) {
      alerts.push({
        kind: 'price_rise',
        sub: s,
        title: t('subsUi.alert.priceRiseTitle', { name: nameOf(s) }),
        body: t(rise.upcoming ? 'subsUi.alert.priceRiseFrom' : 'subsUi.alert.priceRiseSince', {
          from: formatMoney(rise.from, currency),
          to: formatMoney(rise.to, currency),
          date: shortDate(rise.dateISO),
        }),
      });
    }
  }
  // A charge after cancelling first: that one costs money now.
  alerts.sort((a, b) => (a.kind === b.kind ? byName(a.sub, b.sub) : a.kind === 'charged_after_cancel' ? -1 : 1));

  const running = visible.filter((s) => RUNNING_STATUSES.has(s.status));
  const upcoming: UpcomingView[] = running
    .map((s) => {
      const trialEnd = s.status === 'trial' && s.trialEndsAt ? s.trialEndsAt.slice(0, 10) : null;
      const dateISO = (trialEnd ?? s.nextExpectedAt ?? '').slice(0, 10);
      return { s, dateISO, trial: !!trialEnd };
    })
    .filter(({ dateISO }) => !!dateISO && dateISO >= today && dateISO <= horizon)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || byName(a.s, b.s))
    .map(({ s, dateISO, trial }) => ({
      sub: s,
      dateISO,
      when: whenLabel(dateISO, today),
      date: shortDate(dateISO),
      title: nameOf(s),
      note: trial ? t('subsUi.list.trialEnds') : null,
      amount: Number(s.typicalAmount) || 0,
      currency: currencyOf(s, o.userCurrency),
    }));

  const active = visible.filter((s) => s.status === 'active' || s.status === 'confirmed').sort(byNext);
  const trials = visible
    .filter((s) => s.status === 'trial')
    .sort((a, b) => (a.trialEndsAt ?? '9999').localeCompare(b.trialEndsAt ?? '9999') || byName(a, b));
  const review = visible
    .filter((s) => s.status === 'possible')
    .sort((a, b) => b.confidenceScore - a.confidenceScore || byName(a, b));
  const ended = visible
    .filter((s) => OVER_STATUSES.has(s.status))
    .sort((a, b) => (b.canceledAt ?? b.lastChargedAt ?? '').localeCompare(a.canceledAt ?? a.lastChargedAt ?? '') || byName(a, b));

  return {
    alerts,
    upcoming,
    active: active.map((s) => rowOf(s, o)),
    trials: trials.map((s) => rowOf(s, o)),
    review: review.map((s) => rowOf(s, o)),
    ended: ended.map((s) => rowOf(s, o)),
    totals: monthlyTotalsByCurrency(visible, o.userCurrency),
    runningCount: running.length,
    empty: visible.length === 0,
  };
}

// ── Decisions ────────────────────────────────────────────────────────────────

/** The user has not said, and it is still something to decide about. */
export function needsDecision(sub: Subscription): boolean {
  return !sub.decision && (sub.status === 'possible' || sub.status === 'active' || sub.status === 'trial');
}

/** The decisions offered: all three but the one already taken. "Delete" is a dismissal too. */
export function decisionChoices(sub: Subscription): SubscriptionDecision[] {
  return (['keep', 'cancel', 'dismiss'] as const).filter((d) => d !== sub.decision);
}

/** What putting a decision back means: the decision before it, and the day it was cancelled if it was. */
export interface UndoTarget {
  decision: SubscriptionDecision | null;
  canceledAt: string | null;
}

export function undoTarget(before: Subscription): UndoTarget {
  const decision = before.decision ?? null;
  return { decision, canceledAt: decision === 'cancel' ? (before.canceledAt ?? null) : null };
}

/** The line confirming a decision, shown with its Undo. */
export function decisionDoneText(decision: SubscriptionDecision): string {
  return t(`subsUi.detail.done.${decision}`);
}

// ── The detail ───────────────────────────────────────────────────────────────

export interface DetailFact {
  label: string;
  value: string;
}

export interface PriceHistoryView {
  from: number;
  to: number;
  currency: string;
  /** "Went up on Sep 3" / "Goes up on Nov 1". */
  text: string;
}

export interface OccurrenceView {
  id: string;
  date: string;
  amount: number;
}

export interface SubscriptionDetailView {
  title: string;
  status: string;
  currency: string;
  /** The current price per cadence: "€9.99 a month". */
  price: string;
  /** "Keep it, or did you forget?", with what it costs and when. Null once decided. */
  question: { title: string; body: string } | null;
  /** Where the decision stands, once there is one. */
  decided: string | null;
  choices: SubscriptionDecision[];
  facts: DetailFact[];
  priceHistory: PriceHistoryView | null;
  chargedAfterCancel: string | null;
  occurrences: OccurrenceView[];
  /** How to cancel is worth showing: it is not cancelled (or charged since), and not dismissed. */
  showCancelGuide: boolean;
}

const SOURCE_ORDER = ['bank', 'import', 'transaction', 'email', 'manual'] as const;

/** Where it was found, in a fixed order, in words. */
export function sourceLabels(sub: Pick<Subscription, 'sources' | 'source'>): string[] {
  const listed = new Set(
    (sub.sources || sub.source || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return SOURCE_ORDER.filter((s) => listed.has(s)).map((s) => t(`subsUi.source.${s}`));
}

export function buildDetailView(
  sub: Subscription,
  occurrences: readonly SubscriptionOccurrence[],
  o: { today: string; userCurrency: string },
): SubscriptionDetailView {
  const today = o.today;
  const currency = currencyOf(sub, o.userCurrency);
  const name = nameOf(sub);
  const price = priceText(sub.typicalAmount, currency, sub.cadence);
  const trialEnd = sub.trialEndsAt?.slice(0, 10) ?? null;
  const trialOpen = sub.status === 'trial' && !!trialEnd && trialEnd >= today;

  let question: SubscriptionDetailView['question'] = null;
  if (needsDecision(sub)) {
    let body: string;
    if (trialOpen) body = t('subsUi.detail.askTrial', { date: shortDate(trialEnd!), price });
    else if (sub.nextExpectedAt && sub.nextExpectedAt.slice(0, 10) >= today) body = t('subsUi.detail.askNext', { price, date: shortDate(sub.nextExpectedAt) });
    else body = t('subsUi.detail.askPrice', { price });
    question = { title: t('subsUi.detail.question'), body };
  }

  let decided: string | null = null;
  if (sub.decision === 'keep') decided = t('subsUi.detail.state.keep');
  else if (sub.decision === 'cancel') decided = sub.canceledAt ? t('subsUi.detail.state.cancel', { date: longDate(sub.canceledAt) }) : t('subsUi.detail.state.cancelNoDate');
  else if (sub.decision === 'dismiss') decided = t('subsUi.detail.state.dismiss');

  const facts: DetailFact[] = [{ label: t('subsUi.detail.fact.cadence'), value: cadenceLabel(sub.cadence) }];
  if (trialEnd) facts.push({ label: t('subsUi.detail.fact.trialEnds'), value: longDate(trialEnd) });
  if (sub.nextExpectedAt && RUNNING_STATUSES.has(sub.status) && sub.nextExpectedAt.slice(0, 10) !== trialEnd) {
    // A date already past says so, rather than repeating itself
    // ("Oct 1, 2026 · Expected Oct 1"): the charge simply hasn't been seen.
    const late = sub.nextExpectedAt.slice(0, 10) < today;
    facts.push({
      label: t('subsUi.detail.fact.nextCharge'),
      value: `${longDate(sub.nextExpectedAt)} · ${late ? t('subsUi.when.notSeen') : whenLabel(sub.nextExpectedAt, today)}`,
    });
  } else if (sub.nextExpectedAt && sub.status === 'possible') {
    facts.push({ label: t('subsUi.detail.fact.nextCharge'), value: longDate(sub.nextExpectedAt) });
  }
  if (sub.lastChargedAt) facts.push({ label: t('subsUi.detail.fact.lastCharge'), value: longDate(sub.lastChargedAt) });
  if (sub.billedVia) facts.push({ label: t('subsUi.detail.fact.billedVia'), value: t(`subsUi.billedVia.${sub.billedVia}`) });
  const sources = sourceLabels(sub);
  if (sources.length) facts.push({ label: t('subsUi.detail.fact.foundIn'), value: sources.join(t('subsUi.detail.listSeparator')) });

  let priceHistory: PriceHistoryView | null = null;
  const from = sub.previousAmount;
  if (from !== null && from !== undefined && from > 0 && !samePrice(from, sub.typicalAmount) && sub.priceChangedAt) {
    const at = sub.priceChangedAt.slice(0, 10);
    const up = sub.typicalAmount > from;
    const key = at > today ? (up ? 'subsUi.detail.priceGoesUp' : 'subsUi.detail.priceGoesDown') : up ? 'subsUi.detail.priceWentUp' : 'subsUi.detail.priceWentDown';
    priceHistory = { from, to: sub.typicalAmount, currency, text: t(key, { date: longDate(at) }) };
  }

  const after = chargedAfterCancel(sub)
    ? t('subsUi.detail.chargedAfterBody', {
        amount: formatMoney(sub.typicalAmount, currency),
        date: longDate(sub.lastChargedAt!),
        cancelled: longDate(sub.canceledAt ?? sub.lastChargedAt!),
        name,
      })
    : null;

  const seen = new Set<string>();
  const occ = [...occurrences]
    .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
    .sort((a, b) => b.chargedAt.localeCompare(a.chargedAt) || a.id.localeCompare(b.id))
    .map((x) => ({ id: x.id, date: longDate(x.chargedAt), amount: Number(x.amount) || 0 }));

  return {
    title: name,
    status: statusLabel(sub.status),
    currency,
    price,
    question,
    decided,
    choices: decisionChoices(sub),
    facts,
    priceHistory,
    chargedAfterCancel: after,
    occurrences: occ,
    showCancelGuide: sub.status !== 'dismissed' && (sub.status !== 'canceled' || !!after),
  };
}
