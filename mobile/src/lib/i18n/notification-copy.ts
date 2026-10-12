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
import { t } from './core';

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
