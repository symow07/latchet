/**
 * Notification substrate.
 *
 * Wraps expo-notifications for four jobs:
 *   1. Registering a device push token and handing it to the backend so the
 *      bill-reminder job can deliver remote pushes.
 *   2. Firing local notifications for newly-earned badges.
 *   3. Scheduling a daily local "log your spending" streak nudge.
 *   4. The subscription remind loop: the plan subscription-reminders.ts makes
 *      after every detection run, handed to the OS — reminders before
 *      renewals and trial ends, notices for finds, price rises and charges
 *      after cancelling, each with "Keep it" and "Did I forget?".
 *
 * Permission when it is useful (Phase 6 decision 6). Nothing asks at startup:
 * push registration and the streak nudge's on-by-default only go ahead when
 * permission was already granted. The first prompt comes when there is a
 * first reminder worth scheduling, in a moment the user is acting (an import,
 * a Scan, a decision, connecting an inbox, onboarding's payoff — which may
 * also call askForNotifications itself), or when they turn a reminder on.
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
// By name: lint's import/namespace cannot see an enum the package re-exports
// from a declaration file, so `Notifications.AndroidImportance` fails it.
import { AndroidImportance } from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api/api';
import { todayISO } from './dates';
import { onLocaleChange, t } from './i18n/core';
import {
  DEFAULT_NUDGE_TIME,
  applySubscriptionPlan,
  cancelSubscriptionReminders,
  findNudge,
  notificationChannelName,
  otherPendingCount,
  rewordNotifications,
  scheduleNudge,
  setQuickAddCategory,
  setSubscriptionCategory,
  type NotificationIds,
  type SubscriptionNotificationIds,
} from './i18n/notification-copy';
import {
  SUBSCRIPTION_CATEGORY,
  SUBSCRIPTION_FORGOT_ACTION,
  SUBSCRIPTION_KEEP_ACTION,
} from './notification-route';
import { userKeyFor } from './storage-keys';
import type { ReminderRequest } from './subscription-detection';
import {
  IOS_PENDING_LIMIT,
  SUBSCRIPTION_NOTICE_PREFIX,
  SUBSCRIPTION_NOTIFICATION_PREFIX,
  parseLedger,
  permissionStep,
  planIsWorthNotifying,
  planSubscriptionReminders,
  recordInLedger,
  type NoticeLedger,
  type PermissionState,
} from './subscription-reminders';

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

/** The subscription reminders' category and its two answers (notification-route.ts names them). */
const SUBSCRIPTION_IDS: SubscriptionNotificationIds = {
  category: SUBSCRIPTION_CATEGORY,
  keep: SUBSCRIPTION_KEEP_ACTION,
  forgot: SUBSCRIPTION_FORGOT_ACTION,
};

/** Per user (storage-keys.ts): the subscription notices already shown. */
const NOTIFIED_KEY = 'subs_notified_v1';

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
 * Register "Keep it" and "Did I forget?" for the subscription reminders, in
 * the app's language. Asks for nothing, so it is safe at startup; a
 * notification delivered before its category exists shows no buttons.
 */
export async function registerSubscriptionCategory(): Promise<void> {
  return inTurn(async () => {
    try {
      await setSubscriptionCategory(Notifications, SUBSCRIPTION_IDS);
    } catch (e) {
      console.warn('[notifications] registerSubscriptionCategory failed:', e);
    }
  });
}

/** Where notification permission stands, without asking. */
async function permissionState(): Promise<PermissionState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return { status: p.status, canAskAgain: p.canAskAgain };
  } catch {
    return { status: 'denied', canAskAgain: false };
  }
}

/** Show the system prompt. Only from askForNotifications and the plans below. */
async function requestPermission(): Promise<boolean> {
  try {
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Once permission exists, what startup used to do with it: register the push
 * token (bill reminders) and turn the streak nudge on by default. Not awaited
 * by anything running in turn — each queues its own turn.
 */
function afterPermissionGranted(): void {
  void registerForPushNotifications().catch(() => {});
  void applyDefaultStreakReminder().catch(() => {});
}

/**
 * Ask for notification permission now, because there is something worth it —
 * onboarding's payoff, a reminder the user is about to want. Asks only while
 * the OS still can (once per install on iOS); returns whether notifications
 * may be shown.
 */
export async function askForNotifications(): Promise<boolean> {
  const step = permissionStep(await permissionState(), true);
  if (step === 'use') return true;
  if (step === 'skip') return false;
  const granted = await requestPermission();
  if (granted) afterPermissionGranted();
  return granted;
}

/**
 * Permission for something the user just switched on themselves (the streak
 * nudge in Settings): asking then is answering them, not interrupting.
 *
 * Deliberately does not check Device.isDevice. Local notifications — the
 * streak nudge and its quick-add action — work perfectly well on a simulator,
 * and gating them on a physical device made the whole feature untestable. Only
 * push *tokens* need real hardware, and registerForPushNotifications checks
 * for that itself.
 */
async function ensurePermission(): Promise<boolean> {
  const state = await permissionState();
  if (state.status === 'granted') return true;
  if (state.canAskAgain === false) return false;
  return requestPermission();
}

/**
 * Android's one notification channel. Its id stays 'default' — Expo delivers
 * pushes to it — and its name is what Android's settings list, so it is in the
 * app's language. Setting it again renames it.
 */
function setDefaultChannel(): Promise<unknown> {
  return Notifications.setNotificationChannelAsync('default', {
    name: notificationChannelName(),
    importance: AndroidImportance.DEFAULT,
  });
}

/**
 * Fetch the Expo push token and register it with the backend — when
 * permission has already been granted. It never asks: startup calls this, and
 * a prompt at startup is a prompt with no reason attached. Once the user
 * grants permission for a reason, this runs again (afterPermissionGranted).
 * Safe to call on every login — the backend upserts by token. Returns the
 * token, or null if unavailable.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') await setDefaultChannel();
    // A push token identifies real hardware; a simulator cannot have one.
    if (!Device.isDevice) return null;
    if ((await permissionState()).status !== 'granted') return null;

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
 * Turn the streak nudge on the first time on this device that notifications
 * are allowed, and never again: after that, the Settings switch alone decides
 * (lib/streak-reminder-default). Never asks for permission itself.
 */
export async function applyDefaultStreakReminder(): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  const { applyStreakReminderDefault } = await import('./streak-reminder-default');
  await applyStreakReminderDefault({
    isApplied: async () => (await AsyncStorage.getItem(STREAK_DEFAULT_KEY)) !== null,
    markApplied: () => AsyncStorage.setItem(STREAK_DEFAULT_KEY, '1'),
    canSchedule: async () => (await permissionState()).status === 'granted',
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

// ── Subscription reminders ───────────────────────────────────────────────────

async function readNoticeLedger(uid: string): Promise<NoticeLedger> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    return parseLedger(await AsyncStorage.getItem(userKeyFor(uid, NOTIFIED_KEY)));
  } catch {
    return {};
  }
}

async function writeNoticeLedger(uid: string, ledger: NoticeLedger): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(userKeyFor(uid, NOTIFIED_KEY), JSON.stringify(ledger));
  } catch (e) {
    console.warn('[notifications] notice ledger not saved:', e);
  }
}

/**
 * Plan the subscription notifications from a detection run (or a decision)
 * and hand them to the OS: this feature's pending reminders are replaced by
 * the new plan, within what iOS's 64 leave after the app's other
 * notifications, and the run's notices are shown — each once, by a per-user
 * ledger. Asks for permission only when the run is interactive and the plan
 * has something worth it; without permission, this feature holds nothing.
 */
export async function scheduleSubscriptionReminders(request: ReminderRequest): Promise<void> {
  return inTurn(async () => {
    try {
      const now = new Date();
      const today = todayISO(now);
      const ledger = await readNoticeLedger(request.uid);
      const others = await otherPendingCount(Notifications);
      const plan = planSubscriptionReminders({
        subscriptions: request.subscriptions,
        events: request.events,
        today,
        nowMinutes: now.getHours() * 60 + now.getMinutes(),
        notified: Object.keys(ledger),
        announceFinds: request.announceFinds,
        // One spare, so a badge or quick-add notification always has room.
        limit: IOS_PENDING_LIMIT - others - 1,
      });

      const step = permissionStep(await permissionState(), request.interactive && planIsWorthNotifying(plan));
      let granted = step === 'use';
      if (step === 'ask') {
        granted = await requestPermission();
        if (granted) afterPermissionGranted();
      }
      if (!granted) {
        // Nothing can be shown; nothing stale may wait for a later grant.
        await cancelSubscriptionReminders(Notifications);
        const quiet = plan.notices.filter((n) => !n.show).flatMap((n) => n.ledgerKeys);
        if (quiet.length > 0) await writeNoticeLedger(request.uid, recordInLedger(ledger, quiet, today));
        return;
      }

      const applied = await applySubscriptionPlan(Notifications, SUBSCRIPTION_IDS, plan, request.uid);
      if (applied.ledgerKeys.length > 0) {
        await writeNoticeLedger(request.uid, recordInLedger(ledger, applied.ledgerKeys, today));
      }
    } catch (e) {
      console.warn('[notifications] scheduleSubscriptionReminders failed:', e);
    }
  });
}

/**
 * Take every subscription notification off this phone: the pending
 * reminders, and the ones still in Notification Center. On sign-out, so the
 * next person to use the phone is not told about the last one's Netflix.
 */
export async function clearSubscriptionNotifications(): Promise<void> {
  return inTurn(async () => {
    await cancelSubscriptionReminders(Notifications);
    try {
      const shown = await Notifications.getPresentedNotificationsAsync();
      for (const n of shown) {
        const id = n.request.identifier;
        if (id.startsWith(SUBSCRIPTION_NOTIFICATION_PREFIX) || id.startsWith(SUBSCRIPTION_NOTICE_PREFIX)) {
          await Notifications.dismissNotificationAsync(id).catch(() => {});
        }
      }
    } catch {
      // Nothing presented, or the OS cannot say: nothing to take away.
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
    await setSubscriptionCategory(Notifications, SUBSCRIPTION_IDS).catch(() => {});
    if (Platform.OS === 'android') await setDefaultChannel().catch(() => {});
  }).catch(() => {});
  // The subscription reminders hold their words too: plan them again, now in
  // the new language (it schedules in turn, after the rewording above).
  void import('./subscription-detection').then((m) => m.replanReminders()).catch(() => {});
});
