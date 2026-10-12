/**
 * Notification substrate.
 *
 * Wraps expo-notifications for three jobs:
 *   1. Registering a device push token and handing it to the backend so the
 *      bill-reminder job can deliver remote pushes.
 *   2. Firing local notifications for newly-earned badges.
 *   3. Scheduling a daily local "log your spending" streak nudge.
 *
 * Everything degrades gracefully: on web, on a simulator without push support,
 * or when permission is denied, the helpers no-op instead of throwing.
 *
 * The words handed to the OS — the quick-add action, the nudge, the Android
 * channel's name — are built in i18n/notification-copy, in the app's language,
 * and handed over again whenever that language changes (see the bottom of this
 * file): iOS keeps what it was given, and nothing else would reword it.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api/api';
import { onLocaleChange, t } from './i18n/core';
import {
  DEFAULT_NUDGE_TIME,
  findNudge,
  notificationChannelName,
  rewordNotifications,
  scheduleNudge,
  setQuickAddCategory,
  type NotificationIds,
} from './i18n/notification-copy';

// Show alerts + play sound even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const STREAK_NUDGE_ID = 'daily-streak-nudge';
/** Device key: the nudge's on-by-default was applied here (storage-keys.ts). */
const STREAK_DEFAULT_KEY = 'streak_reminder_default_v1';

/**
 * The actionable-notification category the streak nudge carries.
 *
 * iOS matches a delivered notification to a category by this identifier and
 * draws the registered actions under it, so the id has to be stable — change
 * it and already-scheduled notifications lose their buttons.
 */
export const QUICK_ADD_CATEGORY = 'quick-add';
export const QUICK_ADD_ACTION = 'quick-add-log';

const IDS: NotificationIds = {
  category: QUICK_ADD_CATEGORY,
  action: QUICK_ADD_ACTION,
  nudge: STREAK_NUDGE_ID,
};

/**
 * Notification work, one piece at a time, in the order it was asked for.
 *
 * A language change rewords the nudge while the root layout may be scheduling
 * it, and both replace the same request: run side by side, the one that
 * finished last would win, in whichever language it read. In turn, the later
 * request always sees what the earlier one did.
 */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/**
 * Register the quick-add action ("Log it", with its inline text field), in the
 * app's language.
 *
 * Safe to call repeatedly; setNotificationCategoryAsync replaces by id.
 */
export async function registerQuickAddCategory(): Promise<void> {
  return inTurn(async () => {
    try {
      await setQuickAddCategory(Notifications, IDS);
    } catch (e) {
      console.warn('[notifications] registerQuickAddCategory failed:', e);
    }
  });
}

/**
 * Ask for notification permission, if it has not been granted already.
 *
 * Deliberately does not check Device.isDevice. Local notifications — the
 * streak nudge and its quick-add action — work perfectly well on a simulator,
 * and gating them on a physical device made the whole feature untestable. Only
 * push *tokens* need real hardware, and registerForPushNotifications checks
 * for that itself.
 */
async function ensurePermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  return status === 'granted';
}

/**
 * Android's one notification channel. Its id stays 'default' — Expo delivers
 * pushes to it — and its name is what Android's settings list, so it is in the
 * app's language. Setting it again renames it.
 */
function setDefaultChannel(): Promise<unknown> {
  return Notifications.setNotificationChannelAsync('default', {
    name: notificationChannelName(),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Request permission, fetch the Expo push token, and register it with the
 * backend. Safe to call on every login — the backend upserts by token.
 * Returns the token, or null if unavailable.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') await setDefaultChannel();
    // A push token identifies real hardware; a simulator cannot have one.
    if (!Device.isDevice) return null;
    if (!(await ensurePermission())) return null;

    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;
    if (!token) return null;

    await api.post('/api/push-tokens', { token, platform: Platform.OS }).catch((e) => {
      console.warn('[notifications] failed to register push token:', e);
    });
    return token;
  } catch (e) {
    console.warn('[notifications] registerForPushNotifications failed:', e);
    return null;
  }
}

/** Present a local "badge earned" notification immediately. */
export async function presentBadgeEarned(badge: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('badges.unlockedTitle'),
        body: t('badges.unlockedBody', { badge }),
      },
      trigger: null, // fire now
    });
  } catch (e) {
    console.warn('[notifications] presentBadgeEarned failed:', e);
  }
}

/** Stop the daily nudge. Safe to call when nothing is scheduled. */
export async function cancelStreakReminder(): Promise<void> {
  await inTurn(() => Notifications.cancelScheduledNotificationAsync(STREAK_NUDGE_ID).catch(() => {}));
}

/**
 * Whether the daily nudge is currently scheduled.
 *
 * Read from the system rather than a stored flag, so a reminder the user
 * turned off in iOS Settings, or one lost to a reinstall, is reported honestly
 * instead of showing a toggle that claims to be on. In turn, so it answers
 * after any schedule or cancel already asked for.
 */
export async function isStreakReminderScheduled(): Promise<boolean> {
  return inTurn(async () => (await findNudge(Notifications, IDS)) !== null);
}

/**
 * Turn the streak nudge on the first time on this device, and never again:
 * after that, the Settings switch alone decides (lib/streak-reminder-default).
 */
export async function applyDefaultStreakReminder(): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  const { applyStreakReminderDefault } = await import('./streak-reminder-default');
  await applyStreakReminderDefault({
    isApplied: async () => (await AsyncStorage.getItem(STREAK_DEFAULT_KEY)) !== null,
    markApplied: () => AsyncStorage.setItem(STREAK_DEFAULT_KEY, '1'),
    schedule: () => scheduleStreakReminder(),
  });
}

/**
 * Schedule (or reschedule) a daily local reminder to log spending so the user
 * keeps their streak. Idempotent: replaces the previous nudge.
 */
export async function scheduleStreakReminder(
  hour: number = DEFAULT_NUDGE_TIME.hour,
  minute: number = DEFAULT_NUDGE_TIME.minute,
): Promise<void> {
  return inTurn(async () => {
    try {
      if (!(await ensurePermission())) return;
      // The category has to exist before a notification referencing it is
      // delivered, or iOS draws the notification with no actions on it.
      await setQuickAddCategory(Notifications, IDS).catch((e) => {
        console.warn('[notifications] registerQuickAddCategory failed:', e);
      });
      await scheduleNudge(Notifications, IDS, hour, minute);
    } catch (e) {
      console.warn('[notifications] scheduleStreakReminder failed:', e);
    }
  });
}

/**
 * Reword what the OS holds whenever the language changes.
 *
 * The action was registered, and the nudge scheduled, in the language of that
 * moment, and iOS shows those words until it is handed new ones. This covers
 * every change: the device language at launch, the account's language once its
 * data opens, and a choice made in Settings. Android's channel is renamed too;
 * that step is last, so a failure there cannot cost the other two.
 */
onLocaleChange(() => {
  void inTurn(async () => {
    await rewordNotifications(Notifications, IDS);
    if (Platform.OS === 'android') await setDefaultChannel().catch(() => {});
  }).catch(() => {});
});
