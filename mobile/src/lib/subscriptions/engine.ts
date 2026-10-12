/**
 * The one subscription engine.
 *
 * Pure and dependency-free: it takes every charge the phone has (manual
 * entries, statement imports, bank transactions), the email findings, and the
 * stored subscriptions, and returns what to write back. Persistence, fetching
 * and notifications live outside it (lib/subscription-detection runs it), so
 * the personal ledger, business expenses and analytics all agree.
 *
 * What it guarantees:
 *  - Identity is the canonical merchant (merchantKey): one subscription per
 *    merchant across sources. A bank charge, a statement line and an email
 *    receipt for the same payment are one occurrence; the bank's amount wins.
 *  - Cadence comes from the median interval: weekly to yearly. Irregular,
 *    habitual (coffee, groceries, fuel, transport, restaurants), transfer,
 *    refund, fee, debt and tax spending is never proposed.
 *  - The price is the latest sustained amount, never an average; a rise is
 *    announced once, while the stored row still shows the old price.
 *  - The user's decision wins (keep, cancel, dismiss): it is never changed,
 *    and its status is kept, while amounts, dates and occurrences still update.
 *    A dismissed merchant is never proposed again and raises no events.
 *  - A cancellation email ends a subscription and never creates one.
 *  - A quiet re-run on the same input writes nothing and says nothing.
 */
import {
  CADENCE_RANK,
  GRACE_DAYS,
  addDaysISO,
  cadenceOfInterval,
  cadenceWindow,
  daysBetween,
  isISODate,
  maxISO,
  median,
  minISO,
  predictNextDate,
  type KnownCadence,
} from './cadence';
import { aliasFor, cleanMerchant, legacyNormalize, merchantInfo, merchantKey, displayNameFor, type MerchantInfo } from './merchant';
import type {
  BilledVia,
  Cadence,
  ChargeSource,
  DetectedSubscription,
  DetectionEvent,
  DetectionOptions,
  EmailEvidence,
  ReconcileInput,
  ReconcileOccurrence,
  ReconcileResult,
  SourceCharge,
  SubscriptionAlert,
  SubscriptionDecision,
  SubscriptionRecord,
  SubscriptionSource,
  SubscriptionStatus,
} from './types';

export { aliasFor, cleanMerchant, displayNameFor, merchantInfo, merchantKey } from './merchant';
export {
  addDaysISO,
  cadenceOfInterval,
  daysBetween,
  detectCadence,
  monthlyCost,
  monthlyFactor,
  predictNextDate,
} from './cadence';
export type {
  BilledVia,
  Cadence,
  ChargeSource,
  DetectedSubscription,
  DetectionEvent,
  DetectionOptions,
  EmailEvidence,
  EmailKind,
  ReconcileInput,
  ReconcileOccurrence,
  ReconcileResult,
  SourceCharge,
  SubscriptionAlert,
  SubscriptionDecision,
  SubscriptionOccurrenceRef,
  SubscriptionRecord,
  SubscriptionSource,
  SubscriptionStatus,
} from './types';

// ── Identifiers and the older helpers callers still use ─────────────────────

/** The merchant's canonical identity, upper-cased as older callers stored it ("NETFLIX"). */
export function normalizeMerchant(raw: string): string {
  return merchantKey(raw).replace(/_/g, ' ').toUpperCase();
}

/** The proper display name for a stored merchant ("NETFLIX" → "Netflix", "DISNEY PLUS" → "Disney+"). */
export function displayMerchant(normalized: string): string {
  return displayNameFor(merchantKey(normalized), normalized);
}

/**
 * Identity is the merchant, nothing else.
 *
 * The amount used to be baked in, so Netflix going from £10.99 to £12.99
 * produced a second subscription rather than updating the first.
 */
export function subscriptionId(merchantNormalized: string): string {
  return `sub_${merchantNormalized.trim().replace(/\s+/g, '_').toLowerCase()}`;
}

/**
 * Deterministic, so re-scanning cannot duplicate an occurrence. These ids used
 * to be random, which meant the INSERT OR IGNORE guarding them had nothing to
 * collide with: every scan appended the same charges again.
 */
export function occurrenceId(subId: string, chargeId: string): string {
  return `socc_${subId}_${chargeId}`;
}

export function intervalStdDev(intervals: number[]): number {
  if (intervals.length < 2) return 0;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return Math.sqrt(intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length);
}

/**
 * The older confidence formula (charges, a known cadence, a steady interval),
 * kept for callers of the previous API. The engine scores with confidenceOf,
 * which also weighs known merchants, steady prices and email.
 */
export function calcConfidence(occurrences: number, cadence: Cadence, stdDev: number): number {
  let score = occurrences >= 6 ? 50 : occurrences >= 4 ? 40 : occurrences >= 3 ? 30 : 15;
  if (cadence !== 'unknown') score += 30;
  if (stdDev < 2) score += 20;
  else if (stdDev < 5) score += 10;
  return Math.min(score, 100);
}

// ── Tuning ───────────────────────────────────────────────────────────────────

/** A charge seen by two sources within this many days is one payment. */
const SAME_PAYMENT_DAYS = 4;
/** Confidence at which an undecided subscription reads as active rather than possible. */
const ACTIVE_AT = 75;
/** `sources` is written in this order. */
const SOURCE_ORDER: readonly SubscriptionSource[] = ['transaction', 'import', 'bank', 'email', 'manual'];
/** Which source's copy of a payment represents it: the bank's amount wins. */
const PRIORITY: Readonly<Record<SubscriptionSource, number>> = { bank: 0, import: 1, transaction: 2, manual: 3, email: 9 };
const CADENCES: readonly Cadence[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'unknown'];
const DECISION_STATUS: Readonly<Record<SubscriptionDecision, SubscriptionStatus>> = {
  keep: 'confirmed',
  cancel: 'canceled',
  dismiss: 'dismissed',
};
const STATUS_DECISION: Readonly<Partial<Record<string, SubscriptionDecision>>> = {
  confirmed: 'keep',
  canceled: 'cancel',
  dismissed: 'dismiss',
};
/** Categories of everyday spending: an unknown merchant filed under one needs much more evidence. */
const HABIT_CATEGORIES = new Set(['food', 'transport', 'shopping', 'groceries', 'restaurants', 'dining', 'coffee', 'fuel', 'eating out', 'eating_out']);
const SUBSCRIPTION_CATEGORIES = new Set(['subscriptions', 'subscription', 'gym', 'software', 'streaming', 'entertainment']);
const BILLING_KEYS: Readonly<Record<string, BilledVia>> = { apple: 'apple', google_play: 'google_play', paypal: 'paypal' };

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Two prices are the same price within 2.5% (exchange-rate drift), or two cents. */
function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.02, 0.025 * Math.max(Math.abs(a), Math.abs(b)));
}

/** Two sources' copies of one payment agree within 10% (tax lines, rounding), or 50 cents. */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, 0.1 * Math.max(Math.abs(a), Math.abs(b)));
}

function tagOf(source: ChargeSource): SubscriptionSource {
  return source === 'expense' ? 'manual' : source;
}

// ── Charges and payments ─────────────────────────────────────────────────────

interface Entry {
  id: string;
  dateISO: string;
  amount: number;
  /** '' when unknown (an email that did not say). */
  currency: string;
  source: ChargeSource;
  tag: SubscriptionSource;
  raw: string;
  info: MerchantInfo;
  category?: string;
  billedVia: BilledVia | null;
}

/** One payment, however many sources saw it. */
interface Payment {
  id: string;
  dateISO: string;
  amount: number;
  currency: string;
  tags: Set<SubscriptionSource>;
  members: Entry[];
  billedVia: BilledVia | null;
}

/**
 * Folds the copies of one payment together: a bank charge, a statement line,
 * a manual entry and an email receipt for the same merchant, amount and few
 * days are one payment, represented by the highest-priority source (the
 * bank's amount and date win over the email's). Two charges from the same
 * source are only folded when they are exact duplicates.
 */
function foldPayments(entries: Entry[]): Payment[] {
  const sorted = [...entries].sort(
    (a, b) => PRIORITY[a.tag] - PRIORITY[b.tag] || a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id)
  );
  const payments: Payment[] = [];
  for (const e of sorted) {
    let best: Payment | null = null;
    let bestGap = Infinity;
    for (const p of payments) {
      const gap = Math.abs(daysBetween(p.dateISO, e.dateISO));
      if (p.tags.has(e.tag)) {
        // The same source twice: only an exact duplicate (re-imported, re-synced).
        if (gap !== 0 || Math.round(p.amount * 100) !== Math.round(e.amount * 100)) continue;
      } else {
        if (gap > SAME_PAYMENT_DAYS) continue;
        const comparable = p.currency && e.currency && p.currency === e.currency;
        if (comparable && !sameAmount(p.amount, e.amount)) continue;
      }
      if (gap < bestGap) {
        best = p;
        bestGap = gap;
      }
    }
    if (best) {
      best.tags.add(e.tag);
      best.members.push(e);
      best.billedVia ??= e.billedVia;
      if (!best.currency && e.currency) best.currency = e.currency;
    } else {
      payments.push({
        id: e.id,
        dateISO: e.dateISO,
        amount: e.amount,
        currency: e.currency,
        tags: new Set([e.tag]),
        members: [e],
        billedVia: e.billedVia,
      });
    }
  }
  return payments.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ── Rhythm: is this a regular charge, and how often ──────────────────────────

interface Rhythm {
  cadence: Cadence;
  regular: boolean;
  /** Share of intervals that fit the cadence (a missed charge counts half). */
  regularity: number;
  avgInterval: number;
}

function rhythmOf(payments: Payment[]): Rhythm {
  if (payments.length < 2) return { cadence: 'unknown', regular: false, regularity: 0, avgInterval: 0 };
  const intervals: number[] = [];
  for (let i = 1; i < payments.length; i++) intervals.push(daysBetween(payments[i - 1]!.dateISO, payments[i]!.dateISO));
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const cadence = cadenceOfInterval(median(intervals));
  if (cadence === 'unknown') return { cadence, regular: false, regularity: 0, avgInterval };

  const [lo, hi] = cadenceWindow(cadence);
  const period = (lo + hi) / 2;
  let fit = 0;
  let missed = 0;
  let short = 0;
  let other = 0;
  for (const d of intervals) {
    if (d >= lo && d <= hi) fit++;
    else if (d < lo) short++;
    else {
      // A skipped charge: two or three periods apart.
      const k = Math.round(d / period);
      if (k >= 2 && k <= 3 && d >= lo * k && d <= hi * k) missed++;
      else other++;
    }
  }
  const n = intervals.length;
  // A long history may hold a few odd intervals (a refund and re-charge, a late posting).
  const regular = fit >= 1 && (fit + missed) / n >= 0.75 && short <= Math.floor(n / 6) && other <= Math.floor(n / 5);
  return { cadence, regular, regularity: (fit + 0.5 * missed) / n, avgInterval };
}

interface Stream {
  payments: Payment[];
  rhythm: Rhythm;
}

/**
 * The run of payments that is the subscription. Usually all of them; for a
 * known service whose charges interleave (several plans billed through
 * Apple), the regular run with the latest charge, joined to the price it had
 * before when that run ends where this one starts.
 */
function chooseStream(payments: Payment[], allowSplit: boolean): Stream {
  const whole = rhythmOf(payments);
  if (!allowSplit || payments.length < 3) return { payments, rhythm: whole };

  const clusters: Payment[][] = [];
  for (const p of payments) {
    const cluster = clusters.find((c) => samePrice(c[c.length - 1]!.amount, p.amount));
    if (cluster) cluster.push(p);
    else clusters.push([p]);
  }
  const last = (c: Payment[]) => c[c.length - 1]!;
  // Two plans billed side by side (9.99 on the 15th, 52.99 on the 20th) can
  // look like one weekly stream with gaps; a price rise never overlaps itself.
  const big = clusters.filter((c) => c.length >= 3);
  const overlapping = big.some((a) => big.some((b) => a !== b && a[0]!.dateISO < last(b).dateISO && b[0]!.dateISO < last(a).dateISO));
  const concurrent = overlapping && big.reduce((sum, c) => sum + c.length, 0) >= 0.75 * payments.length;
  if (whole.regular && !concurrent) return { payments, rhythm: whole };

  const candidates = clusters
    .filter((c) => c.length >= 2)
    .map((c) => ({ payments: c, rhythm: rhythmOf(c) }))
    .filter((s) => s.rhythm.regular)
    .sort(
      (a, b) =>
        last(b.payments).dateISO.localeCompare(last(a.payments).dateISO) ||
        b.payments.length - a.payments.length ||
        last(b.payments).amount - last(a.payments).amount
    );
  let best = candidates[0];
  if (!best) return { payments, rhythm: whole };

  const [lo, hi] = cadenceWindow(best.rhythm.cadence as KnownCadence);
  const start = best.payments[0]!.dateISO;
  const before = clusters
    .filter((c) => c !== best!.payments && c.length >= 2 && last(c).dateISO < start)
    .filter((c) => {
      const gap = daysBetween(last(c).dateISO, start);
      return gap >= lo && gap <= hi;
    })
    .sort((a, b) => last(b).dateISO.localeCompare(last(a).dateISO))[0];
  if (before) {
    const joined = [...before, ...best.payments];
    const rhythm = rhythmOf(joined);
    if (rhythm.regular) best = { payments: joined, rhythm };
  }
  return best;
}

// ── Price ────────────────────────────────────────────────────────────────────

interface Segment {
  amount: number;
  currency: string;
  first: string;
  count: number;
}

interface Price {
  current: number;
  previous: number | null;
  changedAt: string | null;
  /** The latest charges agree on one price. */
  stable: boolean;
  /** Every price the plan has held for two charges or more. */
  sustained: number[];
  segments: Segment[];
}

function segmentsOf(payments: Payment[]): Segment[] {
  const segments: Segment[] = [];
  for (const p of payments) {
    const seg = segments[segments.length - 1];
    const sameCurrency = !seg || !seg.currency || !p.currency || seg.currency === p.currency;
    if (seg && sameCurrency && samePrice(seg.amount, p.amount)) {
      seg.amount = p.amount;
      seg.currency ||= p.currency;
      seg.count++;
    } else segments.push({ amount: p.amount, currency: p.currency, first: p.dateISO, count: 1 });
  }
  return segments;
}

/**
 * The current price is the latest amount charged at least twice in a row — a
 * single different charge (a pro-rated month, a one-off) is not a new price
 * yet. The previous price is the sustained one before it.
 */
function priceOf(payments: Payment[]): Price {
  const segments = segmentsOf(payments);
  if (segments.length === 0) return { current: 0, previous: null, changedAt: null, stable: false, sustained: [], segments };
  let idx = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i]!.count >= 2) {
      idx = i;
      break;
    }
  }
  const latestCurrency = segments[segments.length - 1]!.currency;
  const sustained = segments.filter((s) => s.count >= 2 && (!s.currency || !latestCurrency || s.currency === latestCurrency)).map((s) => s.amount);
  if (idx < 0) {
    return { current: payments[payments.length - 1]!.amount, previous: null, changedAt: null, stable: false, sustained, segments };
  }
  const cur = segments[idx]!;
  let prev: Segment | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (segments[i]!.count >= 2) {
      prev = segments[i]!;
      break;
    }
  }
  // Billed in another currency before (the user moved): not a price change.
  if (prev && prev.currency && cur.currency && prev.currency !== cur.currency) prev = null;
  return {
    current: cur.amount,
    previous: prev ? prev.amount : null,
    changedAt: prev ? cur.first : null,
    stable: idx === segments.length - 1,
    sustained,
    segments,
  };
}

/** Amounts steady enough for an unknown merchant: one price, or one sustained change. */
function steadyAmounts(segments: Segment[]): boolean {
  return segments.length === 1 || (segments.length === 2 && segments.every((s) => s.count >= 2));
}

function confidenceOf(o: { n: number; known: boolean; regularity: number; stable: boolean; email: boolean; subCategory: boolean }): number {
  let score = o.n >= 6 ? 60 : ([0, 10, 25, 40, 50, 55][o.n] ?? 0);
  if (o.known) score += 20;
  if (o.n >= 2) score += Math.round(15 * o.regularity);
  if (o.stable) score += 10;
  if (o.email) score += 10;
  if (o.subCategory) score += 5;
  return Math.min(100, score);
}

/** Month-end plans keep billing at month end; everything else on the last charge's day. */
function anchorDayOf(payments: Payment[]): number | undefined {
  const days = payments.slice(-3).map((p) => +p.dateISO.slice(8, 10));
  if (days.length >= 2 && days.every((d) => d >= 28)) return Math.max(...days);
  return undefined;
}

/** The next charge from the last one; a plan billed every four weeks stays on four weeks. */
function nextFrom(payments: Payment[], lastISO: string, cadence: Cadence, avgInterval: number): string {
  if (cadence === 'monthly' && payments.length >= 4) {
    const recent = payments.slice(-4);
    const fourWeekly = recent.slice(1).every((p, i) => {
      const d = daysBetween(recent[i]!.dateISO, p.dateISO);
      return d >= 27 && d <= 29;
    });
    if (fourWeekly) return addDaysISO(lastISO, 28);
  }
  return predictNextDate(lastISO, cadence, avgInterval, anchorDayOf(payments));
}

function majority<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  // Later values win ties, so the most recent spelling is used.
  for (const v of values) {
    const c = counts.get(v)!;
    if (c >= bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

// ── Email facts ──────────────────────────────────────────────────────────────

interface EmailFacts {
  trial: { endsAt: string; amount: number | null; currency: string | null; cadence: Cadence; dateISO: string } | null;
  price: { amount: number; previous: number | null; currency: string | null; effective: string; dateISO: string } | null;
  cancel: { dateISO: string } | null;
  /** The next charge date the latest receipt, renewal or price notice states. */
  statedNext: string | null;
  cadenceHint: Cadence;
  /** A receipt, renewal or price notice: the service says this is a subscription. */
  notice: boolean;
  latestNoticeDate: string | null;
  lastAmount: number | null;
  billedVia: BilledVia | null;
  currency: string | null;
  merchantRaw: string | null;
}

function emptyFacts(): EmailFacts {
  return {
    trial: null,
    price: null,
    cancel: null,
    statedNext: null,
    cadenceHint: 'unknown',
    notice: false,
    latestNoticeDate: null,
    lastAmount: null,
    billedVia: null,
    currency: null,
    merchantRaw: null,
  };
}

/** Which merchant an email is about: a known name, else a known sender, else whatever it names. */
function emailMerchant(e: EmailEvidence): MerchantInfo | null {
  const byName = e.merchant ? merchantInfo(e.merchant) : null;
  const byDomain = e.senderDomain ? merchantInfo(e.senderDomain) : null;
  const known = (i: MerchantInfo | null) => !!i?.key && i.kind !== 'unknown' && i.kind !== 'billing';
  if (known(byName)) return byName;
  if (known(byDomain)) return byDomain;
  if (byName?.key) {
    // "Acme Pro" from acme.io: the domain's name is the merchant's identity.
    if (byDomain?.key && byDomain.kind === 'unknown' && byName.key.split('_')[0] === byDomain.key) return byDomain;
    return byName;
  }
  return byDomain?.key ? byDomain : null;
}

const validCurrency = (c: string | null | undefined) => (c && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : null);

// ── Stored rows ──────────────────────────────────────────────────────────────

type StoredRow = SubscriptionRecord & { createdAt?: string | null };

const RECORD_FIELDS: readonly (keyof SubscriptionRecord)[] = [
  'id',
  'merchantDisplay',
  'merchantNormalized',
  'cadence',
  'typicalAmount',
  'currency',
  'confidenceScore',
  'lastChargedAt',
  'nextExpectedAt',
  'status',
  'cancelUrl',
  'cancelNotes',
  'source',
  'sources',
  'decision',
  'canceledAt',
  'trialEndsAt',
  'previousAmount',
  'priceChangedAt',
  'alert',
  'billedVia',
];

function unchanged(next: SubscriptionRecord, stored: StoredRow): boolean {
  for (const f of RECORD_FIELDS) {
    const a = next[f] ?? null;
    const b = f === 'sources' ? (stored.sources ?? '') : (stored[f] ?? null);
    if (typeof a === 'number' || typeof b === 'number') {
      if (typeof a !== 'number' || typeof b !== 'number' || Math.abs(a - b) > 0.004) return false;
    } else if (a !== b) return false;
  }
  return true;
}

function splitSources(value: string | null | undefined): SubscriptionSource[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SubscriptionSource => (SOURCE_ORDER as readonly string[]).includes(s));
}

function effectiveDecision(row: StoredRow | null): SubscriptionDecision | null {
  if (!row) return null;
  if (row.decision === 'keep' || row.decision === 'cancel' || row.decision === 'dismiss') return row.decision;
  // A row from before decisions existed: its status was the decision.
  return STATUS_DECISION[row.status] ?? null;
}

// ── Reconcile ────────────────────────────────────────────────────────────────

interface Group {
  entries: Entry[];
  emails: EmailEvidence[];
  facts: EmailFacts;
  info: MerchantInfo | null;
}

export function reconcileSubscriptions(input: ReconcileInput): ReconcileResult {
  const charges = input.charges ?? [];
  const emails = input.email ?? [];
  const existing = (input.existing ?? []) as StoredRow[];

  // Without a usable `today`, nothing is in the future, and "today" is the
  // latest day the evidence reaches (below) — never a date that ends everything.
  const givenToday = isISODate(input.today) ? input.today : null;
  const cutoff = givenToday ?? '9999-12-31';

  const upserts: SubscriptionRecord[] = [];
  const merges: { fromId: string; intoId: string }[] = [];
  const occurrences: ReconcileOccurrence[] = [];
  const events: DetectionEvent[] = [];

  // How far each source's data reaches: a statement that ends in August cannot
  // say a subscription stopped in September.
  const horizon = new Map<SubscriptionSource, string>();
  const reach = (tag: SubscriptionSource, dateISO: string) => {
    const h = horizon.get(tag);
    if (!h || dateISO > h) horizon.set(tag, dateISO);
  };

  const groups = new Map<string, Group>();
  const groupFor = (key: string): Group => {
    let g = groups.get(key);
    if (!g) {
      g = { entries: [], emails: [], facts: emptyFacts(), info: null };
      groups.set(key, g);
    }
    return g;
  };
  const legacyIndex = new Map<string, Set<string>>();
  const indexLegacy = (raw: string, key: string) => {
    const legacy = legacyNormalize(raw);
    if (!legacy) return;
    const set = legacyIndex.get(legacy) ?? new Set<string>();
    set.add(key);
    legacyIndex.set(legacy, set);
  };
  const currencyCounts = new Map<string, number>();

  for (const c of charges) {
    if (!c || typeof c.merchant !== 'string' || !isISODate(c.dateISO) || c.dateISO > cutoff) continue;
    const amount = Math.abs(Number(c.amount));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const tag = tagOf(c.source);
    reach(tag, c.dateISO);
    const info = merchantInfo(c.merchant);
    if (!info.key || info.excluded) continue;
    const currency = validCurrency(c.currency) ?? '';
    if (currency) currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);
    const g = groupFor(info.key);
    g.entries.push({ id: c.id, dateISO: c.dateISO, amount, currency, source: c.source, tag, raw: c.merchant, info, category: c.category, billedVia: info.billedVia });
    g.info ??= info;
    indexLegacy(c.merchant, info.key);
  }

  const sortedEmails = emails
    .filter((e) => e && isISODate(e.dateISO) && e.dateISO <= cutoff)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.id).localeCompare(String(b.id)));
  for (const e of sortedEmails) {
    reach('email', e.dateISO);
    if (e.kind === 'other') continue;
    const info = emailMerchant(e);
    if (!info?.key) continue;
    const g = groupFor(info.key);
    g.emails.push(e);
    g.info ??= info;
    if (e.merchant) indexLegacy(e.merchant, info.key);
    const f = g.facts;
    const amount = typeof e.amount === 'number' && Number.isFinite(e.amount) && e.amount > 0 ? e.amount : null;
    const currency = validCurrency(e.currency);
    const billedVia = e.billedVia ?? info.billedVia;
    if (billedVia) f.billedVia = billedVia;
    if (currency) f.currency = currency;
    if (e.merchant) f.merchantRaw = e.merchant;
    if (e.kind !== 'cancellation' && e.cadence && e.cadence !== 'unknown' && CADENCES.includes(e.cadence)) f.cadenceHint = e.cadence;

    if (e.kind === 'receipt' || e.kind === 'renewal' || e.kind === 'price_change') {
      f.notice = true;
      f.latestNoticeDate = e.dateISO;
      if (isISODate(e.nextChargeISO)) f.statedNext = e.nextChargeISO;
    }
    if ((e.kind === 'receipt' || e.kind === 'renewal') && amount !== null) {
      f.lastAmount = amount;
      // A renewal notice ("renews on 20 October") announces a charge; it is not one.
      const future = e.kind === 'renewal' && !isISODate(e.chargedISO) && isISODate(e.nextChargeISO) && e.nextChargeISO > e.dateISO;
      const when = isISODate(e.chargedISO) ? e.chargedISO : e.dateISO;
      if (!future && when <= cutoff) {
        g.entries.push({ id: e.id, dateISO: when, amount, currency: currency ?? '', source: 'email', tag: 'email', raw: e.merchant ?? e.senderDomain ?? '', info, billedVia: billedVia ?? null });
      }
    }
    if (e.kind === 'trial_ending') {
      const endsAt = isISODate(e.trialEndsISO) ? e.trialEndsISO : isISODate(e.nextChargeISO) ? e.nextChargeISO : null;
      if (endsAt) f.trial = { endsAt, amount, currency, cadence: e.cadence ?? 'unknown', dateISO: e.dateISO };
    }
    if (e.kind === 'price_change' && amount !== null) {
      const previous = typeof e.previousAmount === 'number' && e.previousAmount > 0 ? e.previousAmount : null;
      const effective = isISODate(e.nextChargeISO) ? e.nextChargeISO : e.dateISO;
      f.price = { amount, previous, currency, effective, dateISO: e.dateISO };
    }
    if (e.kind === 'cancellation') f.cancel = { dateISO: e.dateISO };
  }

  const allHorizons = [...horizon.values()];
  const reached = allHorizons.length ? allHorizons.reduce(maxISO) : null;
  const today = givenToday ?? reached ?? '1970-01-01';
  const globalAsOf = reached ? minISO(today, reached) : today;
  const asOfFor = (tags: Iterable<SubscriptionSource>): string => {
    let best: string | null = null;
    for (const t of tags) {
      const h = horizon.get(t);
      if (h && (!best || h > best)) best = h;
    }
    return best ? minISO(today, best) : globalAsOf;
  };
  const defaultCurrency =
    [...currencyCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    majority(existing.map((r) => r.currency).filter(Boolean)) ??
    'USD';

  // ── Stored rows, keyed; rows for one merchant fold into one ────────────────
  const rowKey = (row: StoredRow): string => {
    const norm = row.merchantNormalized ?? '';
    const legacy = legacyIndex.get(norm);
    if (legacy && legacy.size === 1) return [...legacy][0]!;
    if (legacy && legacy.size > 1) {
      // The older normaliser kept three words, so "PRLV SEPA FREE" named both
      // Free Mobile and the Freebox: the one at the row's price is this row.
      const latestAmount = (key: string) => {
        const es = groups.get(key)?.entries ?? [];
        return es.length ? es.reduce((a, b) => (b.dateISO >= a.dateISO ? b : a)).amount : Infinity;
      };
      return [...legacy].sort(
        (a, b) => Math.abs(latestAmount(a) - row.typicalAmount) - Math.abs(latestAmount(b) - row.typicalAmount) || a.localeCompare(b)
      )[0]!;
    }
    return merchantKey(norm) || merchantKey(row.merchantDisplay ?? '');
  };
  const rowsByKey = new Map<string, StoredRow[]>();
  const takenIds = new Set<string>();
  for (const row of existing) {
    if (!row?.id) continue;
    takenIds.add(row.id);
    const key = rowKey(row);
    if (!key) continue;
    const list = rowsByKey.get(key) ?? [];
    list.push(row);
    rowsByKey.set(key, list);
  }

  const keys = [...new Set([...rowsByKey.keys(), ...groups.keys()])].sort();
  for (const key of keys) {
    const rows = rowsByKey.get(key) ?? [];
    const target = rows.length ? pickTarget(rows, key) : null;
    const folded = rows.filter((r) => r !== target);
    for (const r of folded) merges.push({ fromId: r.id, intoId: target!.id });
    const group = groups.get(key);

    const outcome = evaluate({
      key,
      row: target,
      folded,
      group: group ?? null,
      today,
      globalAsOf,
      asOfFor,
      defaultCurrency,
      takenIds,
    });
    if (!outcome) continue;
    const { record, events: ev, payments } = outcome;
    if (!target || folded.length > 0 || !unchanged(record, target)) upserts.push(record);
    events.push(...ev);
    if (!target) takenIds.add(record.id);
    for (const p of payments) {
      occurrences.push({ subscriptionId: record.id, chargeId: p.id, dateISO: p.dateISO, amount: round2(p.amount) });
    }
  }

  return { upserts, merges, occurrences, events };
}

/** The row the others fold into: the one with a decision, else the oldest. */
function pickTarget(rows: StoredRow[], key: string): StoredRow {
  const decided = rows.filter((r) => effectiveDecision(r));
  const pool = decided.length ? decided : rows;
  const canonical = `sub_${key}`;
  return [...pool].sort(
    (a, b) =>
      (a.createdAt ?? '\uffff').localeCompare(b.createdAt ?? '\uffff') ||
      Number(b.id === canonical) - Number(a.id === canonical) ||
      a.id.localeCompare(b.id)
  )[0]!;
}

interface EvaluateArgs {
  key: string;
  row: StoredRow | null;
  folded: StoredRow[];
  group: Group | null;
  today: string;
  globalAsOf: string;
  asOfFor: (tags: Iterable<SubscriptionSource>) => string;
  defaultCurrency: string;
  takenIds: Set<string>;
}

interface Outcome {
  record: SubscriptionRecord;
  events: DetectionEvent[];
  payments: Payment[];
}

/** Copies a stored row into the engine's exact shape, with folded rows' facts filled in. */
function baseRecord(row: StoredRow, key: string, folded: StoredRow[]): SubscriptionRecord {
  const pick = <K extends keyof SubscriptionRecord>(f: K): SubscriptionRecord[K] => {
    const own = row[f];
    if (own !== null && own !== undefined && own !== '') return own;
    for (const r of folded) if (r[f] !== null && r[f] !== undefined && r[f] !== '') return r[f];
    return (own ?? null) as SubscriptionRecord[K];
  };
  const tags = new Set<SubscriptionSource>();
  for (const r of [row, ...folded]) {
    const listed = splitSources(r.sources);
    for (const t of listed) tags.add(t);
    if (!listed.length && (SOURCE_ORDER as readonly string[]).includes(r.source)) tags.add(r.source);
  }
  return {
    id: row.id,
    merchantDisplay: row.merchantDisplay ?? '',
    merchantNormalized: folded.length ? key : (row.merchantNormalized ?? key),
    cadence: CADENCES.includes(row.cadence) ? row.cadence : 'unknown',
    typicalAmount: Number(row.typicalAmount) || 0,
    currency: row.currency ?? '',
    confidenceScore: Number(row.confidenceScore) || 0,
    lastChargedAt: folded.reduce<string | null>(
      (best, r) => (r.lastChargedAt && (!best || r.lastChargedAt > best) ? r.lastChargedAt : best),
      row.lastChargedAt ?? null
    ),
    nextExpectedAt: row.nextExpectedAt ?? null,
    status: row.status,
    cancelUrl: pick('cancelUrl'),
    cancelNotes: pick('cancelNotes'),
    source: row.source,
    sources: SOURCE_ORDER.filter((t) => tags.has(t)).join(','),
    decision: row.decision ?? null,
    canceledAt: row.canceledAt ?? null,
    trialEndsAt: pick('trialEndsAt'),
    previousAmount: pick('previousAmount'),
    priceChangedAt: pick('priceChangedAt'),
    alert: pick('alert'),
    billedVia: pick('billedVia'),
  };
}

function evaluate(a: EvaluateArgs): Outcome | null {
  const { key, row, folded, group, today } = a;
  const decision = effectiveDecision(row);
  const base = row ? baseRecord(row, key, folded) : null;
  const alias = aliasFor(key);
  const kind = alias?.kind ?? 'unknown';
  const known = kind === 'sub' || kind === 'telecom' || kind === 'billing';
  const facts = group?.facts ?? emptyFacts();
  const entries = group?.entries ?? [];
  const hasEvidence = entries.length > 0 || (group?.emails.length ?? 0) > 0;

  // A stored row nothing speaks about any more is left as it is (folding
  // older copies into it is the only change).
  if (!hasEvidence) {
    if (!row || !base || folded.length === 0) return null;
    return { record: base, events: [], payments: [] };
  }

  const habitual = kind === 'habit' || entries.some((e) => e.info.habitual) || (group?.info?.habitual ?? false);
  // Coffee, groceries, fuel: never proposed, so not worth folding a year of them.
  if (!row && habitual) return null;
  const all = foldPayments(entries);
  const chosen = chooseStream(all, known);
  // Once the user has decided, every charge from the merchant is theirs to see.
  const payments = decision && !chosen.rhythm.regular ? all : chosen.payments;
  const rhythm = decision && !chosen.rhythm.regular ? rhythmOf(all) : chosen.rhythm;
  const n = payments.length;
  const lastPayment = payments[n - 1] ?? null;
  const lastDate = lastPayment?.dateISO ?? null;
  const price = priceOf(payments);

  // ── Cadence ──
  let cadence: Cadence = rhythm.regular ? rhythm.cadence : 'unknown';
  if (cadence === 'unknown' && n <= 1) {
    if (facts.cadenceHint !== 'unknown') cadence = facts.cadenceHint;
    else if (facts.statedNext && lastDate && facts.statedNext > lastDate) cadence = cadenceOfInterval(daysBetween(lastDate, facts.statedNext));
    else if (facts.trial && facts.trial.cadence !== 'unknown') cadence = facts.trial.cadence;
  }
  // The stored cadence stands when the user decided, or when nothing new says otherwise.
  if (cadence === 'unknown' && base && (decision || n <= 1)) cadence = base.cadence;

  // ── Is it a subscription? ──
  const categories = entries.map((e) => e.category?.toLowerCase()).filter((c): c is string => !!c);
  const category = majority(categories);
  const habitCategory = !!category && HABIT_CATEGORIES.has(category);
  const subCategory = !!category && SUBSCRIPTION_CATEGORIES.has(category);
  const byCharges =
    rhythm.regular &&
    cadence !== 'unknown' &&
    (known
      ? n >= 2
      : n >= 3 &&
        steadyAmounts(price.segments) &&
        !(habitCategory && (CADENCE_RANK[cadence] < CADENCE_RANK.monthly || n < 4 || price.segments.length > 1)));
  const byNotice = n <= 1 && facts.notice && (cadence !== 'unknown' || !!facts.statedNext);

  // ── Trial and cancellation ──
  const trial = habitual ? null : facts.trial;
  const converted = !!trial && all.some((p) => p.dateISO >= addDaysISO(trial.endsAt, -3));
  // A trial that turned into a charge is a subscription from its first payment.
  const qualifies = !habitual && (byCharges || byNotice || (converted && n >= 1));
  const openTrial = !!trial && !converted;
  const trialActive = openTrial && today <= trial!.endsAt;
  const cancel = facts.cancel;
  const cancelledLast =
    !!cancel &&
    !all.some((p) => p.dateISO > cancel.dateISO) &&
    !(trial && trial.dateISO > cancel.dateISO) &&
    !(facts.latestNoticeDate && facts.latestNoticeDate > cancel.dateISO);

  if (!row) {
    // Nothing is proposed for a habit, after a cancellation, or without enough evidence.
    if (habitual || cancelledLast) return null;
    if (!qualifies && !openTrial) return null;
  } else if (!decision && !qualifies && !openTrial && !cancelledLast && !facts.price) {
    return staleRow(a, base!, all);
  }

  // ── Price ──
  let current = price.current;
  let previous = price.previous;
  let changedAt = price.changedAt;
  const chargedIn = [...payments].reverse().find((p) => p.currency)?.currency ?? base?.currency ?? null;
  const pc = facts.price && (!facts.price.currency || !chargedIn || facts.price.currency === chargedIn) ? facts.price : null;
  if (pc) {
    const after = payments.filter((p) => p.dateISO >= addDaysISO(pc.effective, -3));
    if (after.length) {
      const latest = after[after.length - 1]!;
      if (samePrice(latest.amount, pc.amount)) {
        const firstNew = after.find((p) => samePrice(p.amount, pc.amount))!;
        previous = pc.previous ?? previous ?? (base && !samePrice(base.typicalAmount, latest.amount) ? base.typicalAmount : null);
        current = latest.amount;
        changedAt = firstNew.dateISO;
      }
    } else if (!lastDate || pc.dateISO >= addDaysISO(lastDate, -3)) {
      // Announced ahead of the charge.
      previous = pc.previous ?? (n ? current : (base?.typicalAmount ?? null));
      current = pc.amount;
      changedAt = pc.effective;
    }
  }
  if (n === 0 && !pc) current = (trial?.amount ?? facts.lastAmount ?? base?.typicalAmount) || 0;
  if (trialActive && trial?.amount) current = trial.amount;
  if (previous !== null && samePrice(previous, current)) {
    previous = null;
    changedAt = null;
  }

  // ── Dates and status ──
  const contributing = new Set<SubscriptionSource>();
  for (const p of payments) for (const t of p.tags) contributing.add(t);
  const asOf = contributing.size ? a.asOfFor(contributing) : a.globalAsOf;
  const predicted = lastDate && cadence !== 'unknown' ? nextFrom(payments, lastDate, cadence, rhythm.avgInterval) : null;
  // The service's own word on the next charge beats the prediction; the later
  // of the two decides whether the subscription has stopped.
  const stated = facts.statedNext && (!lastDate || facts.statedNext > lastDate) ? facts.statedNext : null;
  const expected = stated ?? predicted;
  const latestExpected = stated && predicted ? maxISO(stated, predicted) : expected;

  const support = facts.notice || !!facts.trial || !!facts.price;
  const confidence = confidenceOf({
    n,
    known,
    regularity: rhythm.regular ? rhythm.regularity : 0,
    stable: price.stable && n >= 2,
    email: support,
    subCategory,
  });

  let engineStatus: SubscriptionStatus;
  if (openTrial) engineStatus = trialActive ? 'trial' : a.globalAsOf >= addDaysISO(trial!.endsAt, 7) ? 'ended' : 'possible';
  else if (cancelledLast) engineStatus = 'ended';
  else if (latestExpected && cadence !== 'unknown' && asOf > addDaysISO(latestExpected, GRACE_DAYS[cadence as KnownCadence])) engineStatus = 'ended';
  else engineStatus = confidence >= ACTIVE_AT ? 'active' : 'possible';

  // A subscription that is already over is not news.
  if (!row && engineStatus === 'ended') return null;

  const status = decision ? DECISION_STATUS[decision] : engineStatus;
  let nextExpectedAt: string | null;
  if (engineStatus === 'ended' || decision === 'cancel' || decision === 'dismiss') nextExpectedAt = null;
  else if (openTrial) nextExpectedAt = trial!.endsAt;
  else nextExpectedAt = expected;

  // ── Events ──
  const events: DetectionEvent[] = [];
  const id = row?.id ?? freshId(key, a.takenIds);
  const quiet = decision === 'dismiss';
  let alert: SubscriptionAlert | null = base?.alert ?? null;

  if (!row) {
    if (trialActive) events.push({ type: 'trial_found', subscriptionId: id, trialEndsAt: trial!.endsAt });
    else events.push({ type: 'new', subscriptionId: id });
    if (trialActive) alert = 'trial_ending';
  } else if (!quiet && base) {
    if (decision === 'cancel') {
      // Charged again after the user cancelled: once per charge.
      const since = base.canceledAt ?? base.lastChargedAt;
      const seen = base.lastChargedAt ?? '';
      if (since) {
        for (const p of all) {
          if (p.dateISO > since && p.dateISO > seen) {
            events.push({ type: 'charged_after_cancel', subscriptionId: id, chargedAt: p.dateISO, amount: round2(p.amount) });
            alert = 'charged_after_cancel';
          }
        }
      }
    } else {
      const stored = base.typicalAmount;
      const sameCurrency = !base.currency || !chargedIn || base.currency === chargedIn;
      const rose = sameCurrency && stored > 0 && current > stored && !samePrice(current, stored);
      const wasAPrice = price.sustained.some((x) => samePrice(x, stored)) || (previous !== null && samePrice(previous, stored));
      if (rose && wasAPrice) {
        events.push({ type: 'price_rise', subscriptionId: id, from: round2(stored), to: round2(current) });
        if (alert !== 'charged_after_cancel') alert = 'price_rise';
      }
    }
    if (trialActive && base.trialEndsAt !== trial!.endsAt) {
      events.push({ type: 'trial_found', subscriptionId: id, trialEndsAt: trial!.endsAt });
      alert ??= 'trial_ending';
    }
    if (!decision && base.status !== 'ended' && engineStatus === 'ended') events.push({ type: 'ended', subscriptionId: id });
  }
  if (alert === 'trial_ending' && !trialActive) alert = null;

  // ── The record ──
  const tags = new Set<SubscriptionSource>(splitSources(base?.sources));
  for (const t of contributing) tags.add(t);
  if (support || cancel) tags.add('email');
  const primary = [...tags].sort((x, y) => PRIORITY[x] - PRIORITY[y])[0] ?? 'email';

  // Where it is billed: the latest payment says. A bank or statement line in
  // the merchant's own name is a direct charge (billed through PayPal before,
  // directly now); a hand-typed entry says nothing either way.
  const keyBilling = BILLING_KEYS[key] ?? null;
  const viaPayment = [...payments].reverse().find((p) => p.billedVia);
  let billedVia: BilledVia | null;
  if (keyBilling) billedVia = keyBilling;
  else if (lastPayment?.billedVia) billedVia = lastPayment.billedVia;
  else if (lastPayment && (lastPayment.tags.has('bank') || lastPayment.tags.has('import'))) billedVia = null;
  else billedVia = viaPayment?.billedVia ?? facts.billedVia ?? base?.billedVia ?? null;

  const currency =
    [...payments].reverse().find((p) => p.currency)?.currency ??
    validCurrency(trial?.currency) ??
    facts.currency ??
    (base?.currency || a.defaultCurrency);

  const record: SubscriptionRecord = {
    id,
    merchantDisplay: displayFor(key, payments, facts, base),
    merchantNormalized: key,
    cadence,
    typicalAmount: round2(current),
    currency,
    confidenceScore: confidence,
    lastChargedAt: lastDate && base?.lastChargedAt ? maxISO(lastDate, base.lastChargedAt) : (lastDate ?? base?.lastChargedAt ?? null),
    nextExpectedAt,
    status,
    cancelUrl: base?.cancelUrl ?? null,
    cancelNotes: base?.cancelNotes ?? null,
    source: base && (SOURCE_ORDER as readonly string[]).includes(base.source) ? base.source : primary,
    sources: SOURCE_ORDER.filter((t) => tags.has(t)).join(','),
    decision: base?.decision ?? null,
    canceledAt: base?.canceledAt ?? null,
    trialEndsAt: trial?.endsAt ?? base?.trialEndsAt ?? null,
    previousAmount: previous !== null ? round2(previous) : (base?.previousAmount ?? null),
    priceChangedAt: previous !== null ? changedAt : (base?.priceChangedAt ?? null),
    alert,
    billedVia,
  };
  return { record, events, payments };
}

/**
 * An undecided row whose charges no longer read as a subscription (an old
 * false positive, a merchant now billed irregularly) is not rewritten — but
 * one that has clearly stopped is ended, so it stops being shown as active.
 */
function staleRow(a: EvaluateArgs, base: SubscriptionRecord, all: Payment[]): Outcome {
  const latest = all.length ? all[all.length - 1]!.dateISO : base.lastChargedAt;
  const lastChargedAt = latest && base.lastChargedAt ? maxISO(latest, base.lastChargedAt) : (latest ?? base.lastChargedAt);
  if (lastChargedAt && base.cadence !== 'unknown' && base.status !== 'ended') {
    const tags = new Set<SubscriptionSource>();
    for (const p of all) for (const t of p.tags) tags.add(t);
    const asOf = tags.size ? a.asOfFor(tags) : a.globalAsOf;
    const next = predictNextDate(lastChargedAt, base.cadence, 0);
    if (asOf > addDaysISO(next, GRACE_DAYS[base.cadence as KnownCadence])) {
      return {
        record: { ...base, status: 'ended', nextExpectedAt: null, lastChargedAt },
        events: [{ type: 'ended', subscriptionId: base.id }],
        payments: [],
      };
    }
  }
  return { record: base, events: [], payments: [] };
}

function freshId(key: string, taken: Set<string>): string {
  const base = subscriptionId(key);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** A known merchant's proper name; otherwise the cleaned text the charges use most. */
function displayFor(key: string, payments: Payment[], facts: EmailFacts, base: SubscriptionRecord | null): string {
  const alias = aliasFor(key);
  if (alias) return alias.name;
  const names = payments
    .flatMap((p) => p.members)
    .filter((m) => m.tag !== 'email')
    .map((m) => m.info.display)
    .filter(Boolean);
  const name = majority(names);
  if (name) return name;
  if (facts.merchantRaw) {
    const cleaned = cleanMerchant(facts.merchantRaw);
    if (cleaned) return cleaned;
  }
  return base?.merchantDisplay || displayNameFor(key);
}

// ── The list-shaped detector (analytics) ─────────────────────────────────────

export const DEFAULT_MIN_OCCURRENCES = 2;
export const DEFAULT_CONFIRM_AT = 60;

/**
 * Recurring charges in a ledger, as a list — the analytics view. Same
 * identity, folding, cadence and price rules as reconcileSubscriptions, but
 * with nothing stored: it lists every merchant charged at least
 * `minOccurrences` times on a regular cadence (or four times irregularly).
 * Habits, transfers, refunds and fees are never listed.
 */
export function detectSubscriptions(charges: SourceCharge[], options: DetectionOptions = {}): DetectedSubscription[] {
  const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const confirmAt = options.confirmAt ?? DEFAULT_CONFIRM_AT;

  const groups = new Map<string, Entry[]>();
  for (const c of charges) {
    if (!c || typeof c.merchant !== 'string' || !isISODate(c.dateISO)) continue;
    const amount = Math.abs(Number(c.amount));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const info = merchantInfo(c.merchant);
    if (!info.key || info.excluded || info.habitual) continue;
    const list = groups.get(info.key) ?? [];
    list.push({
      id: c.id,
      dateISO: c.dateISO,
      amount,
      currency: validCurrency(c.currency) ?? c.currency ?? '',
      source: c.source,
      tag: tagOf(c.source),
      raw: c.merchant,
      info,
      category: c.category,
      billedVia: info.billedVia,
    });
    groups.set(info.key, list);
  }

  const detections: DetectedSubscription[] = [];
  for (const [key, entries] of groups) {
    const known = (aliasFor(key)?.kind ?? 'unknown') !== 'unknown';
    const { payments, rhythm } = chooseStream(foldPayments(entries), known);
    if (payments.length < minOccurrences) continue;
    if (!rhythm.regular && payments.length < 4) continue;

    const cadence: Cadence = rhythm.regular ? rhythm.cadence : 'unknown';
    const price = priceOf(payments);
    const last = payments[payments.length - 1]!;
    const members = payments.flatMap((p) => p.members);
    const category = majority(members.map((m) => m.category).filter((c): c is string => !!c)) ?? 'Other';
    const subCategory = SUBSCRIPTION_CATEGORIES.has(category.toLowerCase());
    const confidenceScore = confidenceOf({
      n: payments.length,
      known,
      regularity: rhythm.regular ? rhythm.regularity : 0,
      stable: price.stable,
      email: false,
      subCategory,
    });

    detections.push({
      id: subscriptionId(key),
      merchantDisplay: displayFor(key, payments, emptyFacts(), null),
      merchantNormalized: key,
      cadence,
      typicalAmount: round2(price.current),
      currency: last.currency || payments[0]!.currency,
      confidenceScore,
      lastChargedAt: last.dateISO,
      nextExpectedAt: nextFrom(payments, last.dateISO, cadence, rhythm.avgInterval),
      status: confidenceScore >= confirmAt ? 'confirmed' : 'possible',
      source: payments[0]!.members[0]!.source,
      category,
      totalSpent: round2(payments.reduce((sum, p) => sum + p.amount, 0)),
      occurrences: payments.map((p) => ({ chargeId: p.id, dateISO: p.dateISO, amount: p.amount })),
    });
  }

  // Most expensive first — that is the order a user cares about.
  return detections.sort((a, b) => b.typicalAmount - a.typicalAmount || a.id.localeCompare(b.id));
}
