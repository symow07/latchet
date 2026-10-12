/**
 * The remind loop's plan: which subscription notifications the phone should
 * hold, and which it should show now.
 *
 * Every detection run (lib/subscription-detection.ts) hands this the
 * subscriptions as they now stand and the events the engine raised, and
 * notifications.ts turns the plan into requests the OS holds — after
 * cancelling the ones from the previous plan. So the plan is always the whole
 * truth: a subscription the user cancelled or dismissed simply has no
 * reminders in it any more.
 *
 *   before a renewal   a few days ahead of each renewal of an active, kept or
 *                      trial subscription — a week ahead for a yearly one,
 *                      whose charge is twelve months of money at once.
 *   before a trial     two days before a free trial turns into a charge, and
 *                      the day before.
 *   at once            a new subscription or trial found (several finds are
 *                      one notification), a price rise, a charge after the
 *                      user cancelled. Each only once: the caller keeps a
 *                      ledger of what was shown and passes it back in.
 *
 * Nothing for a dismissed, cancelled or ended subscription, nor for a
 * "possible" one until it reads as active (it would be a guess). Reminders
 * fire at a sensible local hour, never in the past, and the earliest ones win
 * when iOS's 64-pending limit — shared with the app's other notifications —
 * leaves no room for all of them.
 *
 * Pure: dates are YYYY-MM-DD strings, the time of day is minutes since local
 * midnight, and nothing here reads the clock, the OS or storage. The words are
 * not here either: i18n/notification-copy.ts builds them from the plan in the
 * app's language.
 */
import { addDaysISO, addMonthsISO, daysBetween, isISODate } from './subscriptions/cadence';
import type { DetectionEvent } from './subscriptions/types';

/** The fields of a subscription row the plan reads (db.ts's Subscription fits). */
export interface ReminderSubscription {
  id: string;
  merchantDisplay: string;
  cadence: string;
  typicalAmount: number;
  currency: string;
  status: string;
  nextExpectedAt: string | null;
  trialEndsAt?: string | null;
}

/** Every subscription notification's identifier starts with this; nothing else's does. */
export const SUBSCRIPTION_NOTIFICATION_PREFIX = 'subs:';
/** Shown at once, never pending: kept apart so re-planning never touches them. */
export const SUBSCRIPTION_NOTICE_PREFIX = 'subs-now:';

/** When reminders fire, local time: the morning, before the day's spending. */
export const REMINDER_TIME = { hour: 9, minute: 0 } as const;

/** iOS keeps at most this many pending local notifications per app, all features together. */
export const IOS_PENDING_LIMIT = 64;

/**
 * How many days before a renewal its reminder fires. Long enough to cancel in
 * time (a cancellation often has to happen a day before the renewal), and
 * earlier the bigger the charge: a yearly plan gets a week.
 */
export const RENEWAL_LEAD_DAYS: Readonly<Record<string, number>> = {
  weekly: 1,
  biweekly: 2,
  monthly: 3,
  quarterly: 4,
  semiannual: 5,
  yearly: 7,
  unknown: 3,
};

/** Trial reminders: this many days before it converts. */
export const TRIAL_LEAD_DAYS: readonly number[] = [2, 1];

/** Statuses that are running and will charge: they get renewal and trial reminders. */
const RUNNING = new Set(['active', 'confirmed', 'trial']);
/** Statuses that never hear from this feature again. */
const SILENT = new Set(['dismissed', 'canceled', 'ended']);

export type ReminderKind = 'renewal' | 'trial_ending';

/** A reminder the OS holds until its day. */
export interface ScheduledReminder {
  /** Deterministic: the same reminder planned twice replaces itself. */
  identifier: string;
  kind: ReminderKind;
  subscriptionId: string;
  merchant: string;
  amount: number;
  currency: string;
  cadence: string;
  /** YYYY-MM-DD of the renewal, or of the day the trial converts. */
  dueDate: string;
  /** Local day and time it fires. */
  fireDate: string;
  hour: number;
  minute: number;
  /** Whole days from fireDate to dueDate: 1 is "tomorrow". */
  daysBefore: number;
}

/** One subscription in a "found" notice. */
export interface FoundItem {
  subscriptionId: string;
  merchant: string;
  amount: number;
  currency: string;
  cadence: string;
  /** Set for a free trial: the day it converts. */
  trialEndsAt: string | null;
}

interface NoticeBase {
  identifier: string;
  /**
   * False for finds the user is looking at on screen: not shown, but written
   * to the ledger all the same, so they are not announced later either.
   */
  show: boolean;
  /** What to write in the ledger once it has been shown. */
  ledgerKeys: string[];
  /** The subscriptions it is about: one, or several for a batch of finds. */
  subscriptionIds: string[];
}

/** A notification shown at once. */
export type Notice =
  | (NoticeBase & { kind: 'found'; items: FoundItem[] })
  | (NoticeBase & { kind: 'price_rise'; merchant: string; currency: string; from: number; to: number })
  | (NoticeBase & { kind: 'charged_after_cancel'; merchant: string; currency: string; amount: number; chargedAt: string });

export interface ReminderPlan {
  /** Earliest first, at most `limit` of them. */
  scheduled: ScheduledReminder[];
  notices: Notice[];
}

export interface PlanInput {
  subscriptions: readonly ReminderSubscription[];
  /** What this detection run raised; none when only re-planning. */
  events?: readonly DetectionEvent[];
  /** YYYY-MM-DD, the user's local date. */
  today: string;
  /** Minutes since local midnight now: a reminder whose moment has passed is not planned. */
  nowMinutes: number;
  /** Ledger keys of notices already shown. */
  notified?: Iterable<string>;
  /**
   * Announce new finds. False while the user is looking at them on screen (a
   * Scan tap, onboarding's payoff); they are still written to the ledger, so
   * they are not announced later either.
   */
  announceFinds?: boolean;
  /** How many reminders this feature may hold now. */
  limit?: number;
}

/** A notice's ledger key for each event: the same event never shows twice. */
export function ledgerKeyFor(event: DetectionEvent): string | null {
  switch (event.type) {
    case 'new':
      return `new:${event.subscriptionId}`;
    case 'trial_found':
      return `trial:${event.subscriptionId}:${event.trialEndsAt}`;
    case 'price_rise':
      return `price:${event.subscriptionId}:${event.to.toFixed(2)}`;
    case 'charged_after_cancel':
      return `cac:${event.subscriptionId}:${event.chargedAt}:${event.amount.toFixed(2)}`;
    default:
      return null;
  }
}

/**
 * The renewal on or after `today`. A renewal date already behind us (the
 * bank or statement data stops short of today) is stepped forward by the
 * subscription's own rhythm; an irregular one cannot be.
 */
export function upcomingRenewal(dateISO: string, cadence: string, today: string): string | null {
  if (!isISODate(dateISO)) return null;
  if (dateISO >= today) return dateISO;
  const anchor = Number(dateISO.slice(8, 10));
  const months: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };
  const days: Record<string, number> = { weekly: 7, biweekly: 14 };
  for (let k = 1; k <= 600; k++) {
    let next: string;
    if (months[cadence]) next = addMonthsISO(dateISO, k * months[cadence]!, anchor);
    else if (days[cadence]) next = addDaysISO(dateISO, k * days[cadence]!);
    else return null;
    if (next >= today) return next;
  }
  return null;
}

/** The first reminder moment still ahead: today at the hour, or tomorrow if it has passed. */
function earliestFireDate(today: string, nowMinutes: number): string {
  const at = REMINDER_TIME.hour * 60 + REMINDER_TIME.minute;
  return nowMinutes < at ? today : addDaysISO(today, 1);
}

function safeAmount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function reminderFor(
  sub: ReminderSubscription,
  kind: ReminderKind,
  dueDate: string,
  fireDate: string,
): ScheduledReminder {
  const daysBefore = daysBetween(fireDate, dueDate);
  return {
    identifier:
      kind === 'renewal'
        ? `${SUBSCRIPTION_NOTIFICATION_PREFIX}renewal:${sub.id}:${dueDate}`
        : `${SUBSCRIPTION_NOTIFICATION_PREFIX}trial:${sub.id}:${dueDate}:${daysBefore}`,
    kind,
    subscriptionId: sub.id,
    merchant: sub.merchantDisplay,
    amount: safeAmount(sub.typicalAmount),
    currency: sub.currency,
    cadence: sub.cadence,
    dueDate,
    fireDate,
    hour: REMINDER_TIME.hour,
    minute: REMINDER_TIME.minute,
    daysBefore,
  };
}

/** The reminders the OS should hold for one subscription. */
function remindersFor(sub: ReminderSubscription, today: string, earliest: string): ScheduledReminder[] {
  if (!RUNNING.has(sub.status)) return [];
  const out: ScheduledReminder[] = [];

  const trialEnd = sub.trialEndsAt && isISODate(sub.trialEndsAt) && sub.trialEndsAt > today ? sub.trialEndsAt : null;
  if (trialEnd) {
    // The day the trial converts is its first charge: the trial's reminders say so.
    for (const lead of TRIAL_LEAD_DAYS) {
      const fire = addDaysISO(trialEnd, -lead);
      if (fire >= earliest) out.push(reminderFor(sub, 'trial_ending', trialEnd, fire));
    }
  }

  const next = sub.nextExpectedAt ? upcomingRenewal(sub.nextExpectedAt.slice(0, 10), sub.cadence, today) : null;
  // A renewal on or before the trial's end is that same first charge.
  if (next && !(trialEnd && next <= trialEnd) && sub.status !== 'trial') {
    const lead = RENEWAL_LEAD_DAYS[sub.cadence] ?? RENEWAL_LEAD_DAYS.unknown!;
    // Found late (the lead day has gone by), it still warns, as long as there
    // is a morning left before the charge.
    let fire = addDaysISO(next, -lead);
    if (fire < earliest) fire = earliest;
    if (fire < next) out.push(reminderFor(sub, 'renewal', next, fire));
  }
  return out;
}

function foundItem(sub: ReminderSubscription, trialEndsAt: string | null): FoundItem {
  return {
    subscriptionId: sub.id,
    merchant: sub.merchantDisplay,
    amount: safeAmount(sub.typicalAmount),
    currency: sub.currency,
    cadence: sub.cadence,
    trialEndsAt,
  };
}

/** The notices this run's events call for, less the ones already shown. */
function noticesFor(
  subs: ReadonlyMap<string, ReminderSubscription>,
  events: readonly DetectionEvent[],
  notified: ReadonlySet<string>,
  announceFinds: boolean,
  today: string,
): Notice[] {
  const notices: Notice[] = [];
  const found: { item: FoundItem; key: string }[] = [];
  const foundIds = new Set<string>();
  const priceRises = new Map<string, { event: Extract<DetectionEvent, { type: 'price_rise' }>; key: string }>();
  const afterCancel = new Map<string, { latest: Extract<DetectionEvent, { type: 'charged_after_cancel' }>; keys: string[] }>();

  for (const event of events) {
    const key = ledgerKeyFor(event);
    if (!key || notified.has(key)) continue;
    const sub = subs.get(event.subscriptionId);
    // A row that is gone (merged away) or that the user silenced says nothing.
    if (!sub) continue;
    switch (event.type) {
      case 'new':
      case 'trial_found': {
        if (SILENT.has(sub.status) || foundIds.has(sub.id)) break;
        const trialEnds =
          event.type === 'trial_found' && event.trialEndsAt >= today
            ? event.trialEndsAt
            : sub.status === 'trial' && sub.trialEndsAt && sub.trialEndsAt >= today
              ? sub.trialEndsAt
              : null;
        foundIds.add(sub.id);
        found.push({ item: foundItem(sub, trialEnds), key });
        break;
      }
      case 'price_rise':
        if (sub.status === 'dismissed' || sub.status === 'ended') break;
        priceRises.set(sub.id, { event, key });
        break;
      case 'charged_after_cancel': {
        if (sub.status === 'dismissed') break;
        const held = afterCancel.get(sub.id);
        if (!held) afterCancel.set(sub.id, { latest: event, keys: [key] });
        else {
          held.keys.push(key);
          if (event.chargedAt > held.latest.chargedAt) held.latest = event;
        }
        break;
      }
    }
  }

  if (found.length > 0) {
    const ids = found.map((f) => f.item.subscriptionId);
    notices.push({
      kind: 'found',
      identifier: `${SUBSCRIPTION_NOTICE_PREFIX}found:${today}:${ids.slice().sort().join(',')}`.slice(0, 200),
      show: announceFinds,
      ledgerKeys: found.map((f) => f.key),
      subscriptionIds: ids,
      items: found.map((f) => f.item),
    });
  }
  for (const { event, key } of priceRises.values()) {
    const sub = subs.get(event.subscriptionId)!;
    notices.push({
      kind: 'price_rise',
      identifier: `${SUBSCRIPTION_NOTICE_PREFIX}${key}`,
      show: true,
      ledgerKeys: [key],
      subscriptionIds: [sub.id],
      merchant: sub.merchantDisplay,
      currency: sub.currency,
      from: event.from,
      to: event.to,
    });
  }
  for (const { latest, keys } of afterCancel.values()) {
    const sub = subs.get(latest.subscriptionId)!;
    notices.push({
      kind: 'charged_after_cancel',
      identifier: `${SUBSCRIPTION_NOTICE_PREFIX}${keys[keys.length - 1]}`,
      show: true,
      ledgerKeys: keys,
      subscriptionIds: [sub.id],
      merchant: sub.merchantDisplay,
      currency: sub.currency,
      amount: latest.amount,
      chargedAt: latest.chargedAt,
    });
  }
  return notices;
}

/** The whole plan: what the OS should hold, and what to show now. */
export function planSubscriptionReminders(input: PlanInput): ReminderPlan {
  const today = input.today;
  const earliest = earliestFireDate(today, input.nowMinutes);
  const byId = new Map<string, ReminderSubscription>();
  for (const s of input.subscriptions) if (s?.id) byId.set(s.id, s);

  const scheduled = [...byId.values()]
    .flatMap((s) => remindersFor(s, today, earliest))
    .sort(
      (a, b) =>
        a.fireDate.localeCompare(b.fireDate) ||
        a.hour * 60 + a.minute - (b.hour * 60 + b.minute) ||
        a.identifier.localeCompare(b.identifier),
    );
  const limit = Math.max(0, Math.floor(input.limit ?? IOS_PENDING_LIMIT - 1));

  const notified = new Set(input.notified ?? []);
  const notices = noticesFor(byId, input.events ?? [], notified, input.announceFinds ?? true, today);
  return { scheduled: scheduled.slice(0, limit), notices };
}

/** Whether a plan has anything worth asking for notification permission over. */
export function planIsWorthNotifying(plan: ReminderPlan): boolean {
  return plan.scheduled.length > 0 || plan.notices.some((n) => n.show);
}

// ── The data a subscription notification carries ─────────────────────────────

/** `content.data` of every subscription notification. */
export interface SubscriptionNotificationData {
  type: 'subscription';
  /** The one it is about; for a batch of finds, the first of them. */
  subscriptionId: string;
  /** Every one it is about: one, or a batch of finds. */
  subscriptionIds: string[];
  /** The user it was planned for: a notification left over from another account does nothing. */
  uid: string;
}

export function notificationData(subscriptionIds: readonly string[], uid: string): SubscriptionNotificationData {
  return { type: 'subscription', subscriptionId: subscriptionIds[0] ?? '', subscriptionIds: [...subscriptionIds], uid };
}

// ── Permission, only when it is useful ───────────────────────────────────────

export interface PermissionState {
  status: string;
  /** False once the user has answered: iOS will not show the prompt again. */
  canAskAgain?: boolean;
}

/**
 * What to do about notification permission: use it when granted; ask only
 * when there is something worth a notification and the OS still can ask;
 * otherwise do without. Nothing at startup is "worth it" — that is the point.
 */
export function permissionStep(state: PermissionState | null | undefined, worthIt: boolean): 'use' | 'ask' | 'skip' {
  if (state?.status === 'granted') return 'use';
  if (!worthIt) return 'skip';
  if (state?.status === 'undetermined' && state.canAskAgain !== false) return 'ask';
  return 'skip';
}

// ── The ledger of notices shown ──────────────────────────────────────────────

/** Ledger entries are kept this long; an event older than that cannot come back. */
const LEDGER_DAYS = 400;
const LEDGER_MAX = 1000;

/** Ledger key → YYYY-MM-DD it was shown. */
export type NoticeLedger = Record<string, string>;

export function parseLedger(raw: string | null | undefined): NoticeLedger {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: NoticeLedger = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && isISODate(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** The ledger with `keys` added today, old entries dropped and its size bounded. */
export function recordInLedger(ledger: NoticeLedger, keys: readonly string[], today: string): NoticeLedger {
  const merged: NoticeLedger = { ...ledger };
  for (const k of keys) merged[k] = today;
  const oldest = addDaysISO(today, -LEDGER_DAYS);
  const kept = Object.entries(merged)
    .filter(([, d]) => d >= oldest)
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, LEDGER_MAX);
  return Object.fromEntries(kept);
}
