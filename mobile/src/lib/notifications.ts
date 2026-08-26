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
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api/api';

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

/**
 * The actionable-notification category the streak nudge carries.
 *
 * iOS matches a delivered notification to a category by this identifier and
 * draws the registered actions under it, so the id has to be stable — change
 * it and already-scheduled notifications lose their buttons.
 */
export const QUICK_ADD_CATEGORY = 'quick-add';
export const QUICK_ADD_ACTION = 'quick-add-log';

/**
 * Register the "Log it" action with its inline text field.
 *
 * Safe to call repeatedly; setNotificationCategoryAsync replaces by id.
 */
export async function registerQuickAddCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(QUICK_ADD_CATEGORY, [
      {
        identifier: QUICK_ADD_ACTION,
        buttonTitle: 'Log it',
        textInput: {
          submitButtonTitle: 'Save',
          placeholder: 'e.g. 12.50 coffee',
        },
        options: {
          // Not opening the app is the whole point — logging from the lock
          // screen costs the seconds the action exists to save.
          opensAppToForeground: false,
        },
      },
    ]);
  } catch (e) {
    console.warn('[notifications] registerQuickAddCategory failed:', e);
  }
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
 * Request permission, fetch the Expo push token, and register it with the
 * backend. Safe to call on every login — the backend upserts by token.
 * Returns the token, or null if unavailable.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
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
        title: '🏆 Badge unlocked!',
        body: `You earned "${badge}". Keep it up!`,
      },
      trigger: null, // fire now
    });
  } catch (e) {
    console.warn('[notifications] presentBadgeEarned failed:', e);
  }
}

/**
 * Schedule (or reschedule) a daily local reminder to log spending so the user
 * keeps their streak. Idempotent: cancels the previous nudge first.
 */
export async function scheduleStreakReminder(hour = 20, minute = 0): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    await Notifications.cancelScheduledNotificationAsync(STREAK_NUDGE_ID).catch(() => {});
    // The category has to exist before a notification referencing it is
    // delivered, or iOS draws the notification with no actions on it.
    await registerQuickAddCategory();
    await Notifications.scheduleNotificationAsync({
      identifier: STREAK_NUDGE_ID,
      content: {
        title: "Don't break your streak 🔥",
        body: 'Log today\'s spending to keep your logging streak alive.',
        categoryIdentifier: QUICK_ADD_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  } catch (e) {
    console.warn('[notifications] scheduleStreakReminder failed:', e);
  }
}
