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

async function ensurePermission(): Promise<boolean> {
  if (!Device.isDevice) return false; // Push tokens require a physical device.
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
    await Notifications.scheduleNotificationAsync({
      identifier: STREAK_NUDGE_ID,
      content: {
        title: "Don't break your streak 🔥",
        body: 'Log today\'s spending to keep your logging streak alive.',
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
