/**
 * The words the app hands the operating system for its notifications.
 *
 * Most text is read through t() each time it is drawn. These are not: iOS
 * keeps the lock-screen action's button and text field from the moment the
 * category is registered, and a scheduled nudge keeps the title and body it
 * was scheduled with, night after night. Phase 4 left them as English in
 * notifications.ts. Built here, they are in the app's language when they are
 * handed over — and rewordNotifications hands the OS the new words when that
 * language changes (notifications.ts calls it from onLocaleChange).
 *
 * expo-notifications is only a type here and the OS is passed in, so the copy
 * and the rewording are tested without a device (notifications.test.ts).
 */
import type * as Notifications from 'expo-notifications';
import { getIntlTag, t } from './core';
import {
  SUBSCRIPTION_NOTIFICATION_PREFIX,
  notificationData,
  type Notice,
  type ReminderPlan,
  type ScheduledReminder,
} from '../subscription-reminders';

/** The expo-notifications calls made here: the real module in the app, a stand-in in tests. */
export type NotificationOS = Pick<
  typeof Notifications,
  | 'setNotificationCategoryAsync'
  | 'getAllScheduledNotificationsAsync'
  | 'scheduleNotificationAsync'
  | 'cancelScheduledNotificationAsync'
  | 'SchedulableTriggerInputTypes'
>;

/**
 * The identifiers the OS knows these notifications by. Owned by
 * notifications.ts — iOS matches a delivered nudge to its actions by them, so
 * they never change with the language.
 */
export interface NotificationIds {
  /** The actionable category the nudge carries. */
  category: string;
  /** The quick-add action inside it. */
  action: string;
  /** The daily nudge's request. */
  nudge: string;
}

/** When the nudge fires unless the OS says otherwise: the evening, after the day's spending. */
export const DEFAULT_NUDGE_TIME = { hour: 20, minute: 0 } as const;

/** The quick-add action — "Log it" with its text field — in the app's language now. */
export function quickAddAction(identifier: string): Notifications.NotificationAction {
  return {
    identifier,
    buttonTitle: t('notifications.quickAddAction'),
    textInput: {
      submitButtonTitle: t('notifications.quickAddSave'),
      placeholder: t('notifications.quickAddPlaceholder'),
    },
    options: {
      // Not opening the app is the whole point — logging from the lock
      // screen costs the seconds the action exists to save.
      opensAppToForeground: false,
    },
  };
}

/** The daily nudge's words, in the app's language now. */
export function streakNudgeContent(): { title: string; body: string } {
  return { title: t('notifications.streakTitle'), body: t('notifications.streakBody') };
}

/** What Android's notification settings call the app's one channel. */
export function notificationChannelName(): string {
  return t('notifications.channelName');
}

/**
 * The time a scheduled daily nudge fires at.
 *
 * iOS reports a daily trigger as a calendar trigger (`dateComponents`),
 * Android as `{ type: 'daily', hour, minute }`. Anything unreadable falls back
 * to the default, which is what every nudge has been scheduled with so far.
 */
export function nudgeTime(trigger: unknown): { hour: number; minute: number } {
  const raw = (trigger && typeof trigger === 'object' ? trigger : {}) as {
    hour?: unknown;
    minute?: unknown;
    dateComponents?: { hour?: unknown; minute?: unknown } | null;
  };
  const hour = raw.hour ?? raw.dateComponents?.hour;
  const minute = raw.minute ?? raw.dateComponents?.minute;
  if (typeof hour !== 'number') return { ...DEFAULT_NUDGE_TIME };
  return { hour, minute: typeof minute === 'number' ? minute : 0 };
}

/** Register the quick-add action under its category. setNotificationCategoryAsync replaces by id. */
export async function setQuickAddCategory(os: NotificationOS, ids: NotificationIds): Promise<void> {
  await os.setNotificationCategoryAsync(ids.category, [quickAddAction(ids.action)]);
}

/** The nudge as the OS holds it, or null when none is scheduled or the OS cannot say. */
export async function findNudge(
  os: NotificationOS,
  ids: NotificationIds,
): Promise<Notifications.NotificationRequest | null> {
  try {
    const scheduled = await os.getAllScheduledNotificationsAsync();
    return scheduled.find((n) => n.identifier === ids.nudge) ?? null;
  } catch {
    return null;
  }
}

/**
 * Schedule the daily nudge, replacing any already scheduled. The category has
 * to be registered first, or iOS draws it without the quick-add action.
 */
export async function scheduleNudge(
  os: NotificationOS,
  ids: NotificationIds,
  hour: number,
  minute: number,
): Promise<void> {
  await os.cancelScheduledNotificationAsync(ids.nudge).catch(() => {});
  await os.scheduleNotificationAsync({
    identifier: ids.nudge,
    content: { ...streakNudgeContent(), categoryIdentifier: ids.category },
    trigger: { type: os.SchedulableTriggerInputTypes.DAILY, hour, minute },
  });
}

/**
 * Hand the OS the current language's words: re-register the action, and
 * reschedule the nudge — at the time it already had — if it is worded in
 * another language. A nudge already in this language is left alone, and none
 * is created where the user has none.
 *
 * Never rejects: it runs from a language change, which has no one to report to.
 */
export async function rewordNotifications(os: NotificationOS, ids: NotificationIds): Promise<void> {
  try {
    await setQuickAddCategory(os, ids);
  } catch (e) {
    console.warn('[notifications] could not re-register the quick-add action:', e);
  }
  const nudge = await findNudge(os, ids);
  if (!nudge) return;
  const words = streakNudgeContent();
  if (nudge.content.title === words.title && nudge.content.body === words.body) return;
  const { hour, minute } = nudgeTime(nudge.trigger);
  try {
    await scheduleNudge(os, ids, hour, minute);
  } catch (e) {
    console.warn('[notifications] could not reword the streak nudge:', e);
  }
}

// ── Subscription reminders ───────────────────────────────────────────────────
//
// The remind loop (subscription-reminders.ts plans it, notifications.ts wires
// it). Every one of these asks the same thing — "Keep it, or did you forget?"
// — and carries the two answers as actions. Amounts are in the subscription's
// own currency, dates and words in the app's language at the moment they are
// handed over; a language change re-plans them (notifications.ts).

/** The identifiers iOS knows the subscription notifications' category and actions by. */
export interface SubscriptionNotificationIds {
  category: string;
  keep: string;
  forgot: string;
}

/** "Keep it" and "Did I forget?". Both open the app on the subscription. */
export function subscriptionActions(ids: SubscriptionNotificationIds): Notifications.NotificationAction[] {
  return [
    {
      identifier: ids.keep,
      buttonTitle: t('subsNotify.actionKeep'),
      // Opens the app: the decision is recorded there, by the user's own
      // database, and the subscription is shown with it.
      options: { opensAppToForeground: true },
    },
    {
      identifier: ids.forgot,
      buttonTitle: t('subsNotify.actionForgot'),
      options: { opensAppToForeground: true },
    },
  ];
}

/** Register the two actions under the subscription category. Asks for no permission. */
export async function setSubscriptionCategory(os: NotificationOS, ids: SubscriptionNotificationIds): Promise<void> {
  await os.setNotificationCategoryAsync(ids.category, subscriptionActions(ids));
}

/**
 * An amount in a currency, the app language's way ("€12.99", "12,99 €",
 * "US$12.99"). The currency's own symbol rather than a narrow one: "$" alone
 * would not say whether a Canadian plan is in Canadian dollars.
 */
export function moneyIn(amount: number, currency: string): string {
  const code = (currency || '').toUpperCase();
  try {
    return new Intl.NumberFormat(getIntlTag(), { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`.trim();
  }
}

/** A YYYY-MM-DD day, short, in the app's language ("Oct 20", "20 oct.", "10月20日"). */
export function shortDate(dateISO: string): string {
  const [y, m, d] = [Number(dateISO.slice(0, 4)), Number(dateISO.slice(5, 7)), Number(dateISO.slice(8, 10))];
  try {
    // Formatted in UTC from a UTC instant: the day is the string's day, in every time zone.
    return new Intl.DateTimeFormat(getIntlTag(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  } catch {
    return dateISO.slice(0, 10);
  }
}

/** "€12.99 a month", or null when the price is not known. */
function priceText(amount: number, currency: string, cadence: string): string | null {
  if (!(amount > 0)) return null;
  const money = moneyIn(amount, currency);
  switch (cadence) {
    case 'weekly':
      return t('subsNotify.price.weekly', { amount: money });
    case 'biweekly':
      return t('subsNotify.price.biweekly', { amount: money });
    case 'monthly':
      return t('subsNotify.price.monthly', { amount: money });
    case 'quarterly':
      return t('subsNotify.price.quarterly', { amount: money });
    case 'semiannual':
      return t('subsNotify.price.semiannual', { amount: money });
    case 'yearly':
      return t('subsNotify.price.yearly', { amount: money });
    default:
      return t('subsNotify.price.unknown', { amount: money });
  }
}

/** A reminder's words: before a renewal, or before a trial converts. */
export function reminderContent(r: ScheduledReminder): { title: string; body: string } {
  const price = priceText(r.amount, r.currency, r.cadence);
  const count = r.daysBefore;
  if (r.kind === 'trial_ending') {
    return {
      title: t('subsNotify.trialTitle', { count, merchant: r.merchant }),
      body: price ? t('subsNotify.trialBody', { price }) : t('subsNotify.trialBodyNoPrice'),
    };
  }
  const date = shortDate(r.dueDate);
  return {
    title:
      r.cadence === 'yearly'
        ? t('subsNotify.renewalYearlyTitle', { merchant: r.merchant })
        : t('subsNotify.renewalTitle', { merchant: r.merchant }),
    body: price
      ? t('subsNotify.renewalBody', { count, price, date })
      : t('subsNotify.renewalBodyNoPrice', { count, date }),
  };
}

/** Up to three names, then "and N more". */
function namesOf(merchants: readonly string[]): string {
  const shown = merchants.slice(0, 3).join(t('subsNotify.nameSeparator'));
  const more = merchants.length - 3;
  return more > 0 ? t('subsNotify.namesAndMore', { names: shown, count: more }) : shown;
}

/** A notice's words: what was found, a price rise, a charge after cancelling. */
export function noticeContent(n: Notice): { title: string; body: string } {
  switch (n.kind) {
    case 'found': {
      if (n.items.length > 1) {
        return {
          title: t('subsNotify.batchTitle', { count: n.items.length }),
          body: t('subsNotify.batchBody', { names: namesOf(n.items.map((i) => i.merchant)) }),
        };
      }
      const item = n.items[0]!;
      const price = priceText(item.amount, item.currency, item.cadence);
      if (item.trialEndsAt) {
        const date = shortDate(item.trialEndsAt);
        return {
          title: t('subsNotify.trialFoundTitle', { merchant: item.merchant }),
          body: price
            ? t('subsNotify.trialFoundBody', { date, price })
            : t('subsNotify.trialFoundBodyNoPrice', { date }),
        };
      }
      return {
        title: t('subsNotify.foundTitle', { merchant: item.merchant }),
        body: price ? t('subsNotify.foundBody', { price }) : t('subsNotify.foundBodyNoPrice'),
      };
    }
    case 'price_rise':
      return {
        title: t('subsNotify.priceRiseTitle', { merchant: n.merchant }),
        body: t('subsNotify.priceRiseBody', { from: moneyIn(n.from, n.currency), to: moneyIn(n.to, n.currency) }),
      };
    case 'charged_after_cancel':
      return {
        title: t('subsNotify.chargedAfterCancelTitle', { merchant: n.merchant }),
        body: t('subsNotify.chargedAfterCancelBody', {
          amount: moneyIn(n.amount, n.currency),
          date: shortDate(n.chargedAt),
        }),
      };
  }
}

/** The local moment a reminder fires: its day, at its hour, on the phone's clock. */
export function reminderMoment(r: ScheduledReminder): Date {
  const [y, m, d] = [Number(r.fireDate.slice(0, 4)), Number(r.fireDate.slice(5, 7)), Number(r.fireDate.slice(8, 10))];
  return new Date(y, m - 1, d, r.hour, r.minute, 0, 0);
}

/** What applying a plan did. */
export interface AppliedPlan {
  scheduled: string[];
  cancelled: string[];
  shown: string[];
  /** Ledger keys to record: every notice handled, shown or deliberately kept quiet. */
  ledgerKeys: string[];
}

/**
 * Hand the OS a plan: cancel this feature's pending reminders the plan no
 * longer has, schedule (or replace) the ones it has, and show its notices.
 * The category is registered first, or iOS draws them without their actions.
 * `uid` goes into each notification's data, so a tap acts only for that user.
 *
 * Other features' notifications are never touched: only identifiers under
 * SUBSCRIPTION_NOTIFICATION_PREFIX are this feature's.
 */
export async function applySubscriptionPlan(
  os: NotificationOS,
  ids: SubscriptionNotificationIds,
  plan: ReminderPlan,
  uid: string,
): Promise<AppliedPlan> {
  const result: AppliedPlan = { scheduled: [], cancelled: [], shown: [], ledgerKeys: [] };
  try {
    await setSubscriptionCategory(os, ids);
  } catch (e) {
    console.warn('[notifications] could not register the subscription actions:', e);
  }

  const wanted = new Set(plan.scheduled.map((r) => r.identifier));
  let pending: Notifications.NotificationRequest[] = [];
  try {
    pending = await os.getAllScheduledNotificationsAsync();
  } catch {
    pending = [];
  }
  for (const request of pending) {
    const id = request.identifier;
    if (!id.startsWith(SUBSCRIPTION_NOTIFICATION_PREFIX) || wanted.has(id)) continue;
    await os.cancelScheduledNotificationAsync(id).catch(() => {});
    result.cancelled.push(id);
  }

  for (const r of plan.scheduled) {
    try {
      await os.scheduleNotificationAsync({
        identifier: r.identifier,
        content: {
          ...reminderContent(r),
          categoryIdentifier: ids.category,
          data: { ...notificationData([r.subscriptionId], uid) },
        },
        trigger: { type: os.SchedulableTriggerInputTypes.DATE, date: reminderMoment(r) },
      });
      result.scheduled.push(r.identifier);
    } catch (e) {
      console.warn('[notifications] could not schedule a subscription reminder:', e);
    }
  }

  for (const n of plan.notices) {
    if (!n.show) {
      result.ledgerKeys.push(...n.ledgerKeys);
      continue;
    }
    try {
      await os.scheduleNotificationAsync({
        identifier: n.identifier,
        content: {
          ...noticeContent(n),
          categoryIdentifier: ids.category,
          data: { ...notificationData(n.subscriptionIds, uid) },
        },
        trigger: null,
      });
      result.shown.push(n.identifier);
      result.ledgerKeys.push(...n.ledgerKeys);
    } catch (e) {
      console.warn('[notifications] could not show a subscription notice:', e);
    }
  }
  return result;
}

/** Cancel every pending subscription reminder (sign-out, or no permission any more). */
export async function cancelSubscriptionReminders(os: NotificationOS): Promise<number> {
  let pending: Notifications.NotificationRequest[] = [];
  try {
    pending = await os.getAllScheduledNotificationsAsync();
  } catch {
    return 0;
  }
  let cancelled = 0;
  for (const request of pending) {
    if (!request.identifier.startsWith(SUBSCRIPTION_NOTIFICATION_PREFIX)) continue;
    await os.cancelScheduledNotificationAsync(request.identifier).catch(() => {});
    cancelled++;
  }
  return cancelled;
}

/** How many pending notifications belong to other features: what the 64 left for this one is counted from. */
export async function otherPendingCount(os: NotificationOS): Promise<number> {
  try {
    const pending = await os.getAllScheduledNotificationsAsync();
    return pending.filter((n) => !n.identifier.startsWith(SUBSCRIPTION_NOTIFICATION_PREFIX)).length;
  } catch {
    return 1;
  }
}
