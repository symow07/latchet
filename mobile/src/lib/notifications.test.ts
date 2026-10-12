import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as Notifications from 'expo-notifications';
import en from './i18n/locales/en.json';
import fr from './i18n/locales/fr.json';
import ar from './i18n/locales/ar.json';
import zh from './i18n/locales/zh.json';
import { onLocaleChange, setLocale, type AppLocale } from './i18n/core';
import {
  applySubscriptionPlan,
  cancelSubscriptionReminders,
  noticeContent,
  notificationChannelName,
  nudgeTime,
  quickAddAction,
  reminderContent,
  rewordNotifications,
  scheduleNudge,
  setQuickAddCategory,
  setSubscriptionCategory,
  streakNudgeContent,
  type NotificationIds,
  type NotificationOS,
  type SubscriptionNotificationIds,
} from './i18n/notification-copy';
import subsNotify from './i18n/locales/fragments/subsNotify.json';
import {
  DEFAULT_ACTION,
  SUBSCRIPTION_CATEGORY,
  SUBSCRIPTION_FORGOT_ACTION,
  SUBSCRIPTION_KEEP_ACTION,
  subscriptionResponse,
} from './notification-route';
import { planSubscriptionReminders, type Notice, type ScheduledReminder } from './subscription-reminders';

/**
 * The words the app hands the OS for its notifications, in the app's language.
 *
 * notifications.ts itself cannot load here (it imports expo-notifications,
 * expo-device and react-native, and Bun's module mocks are process-wide — two
 * other test files already stand in for expo-notifications with a narrower
 * shape). Its words and its rewording live in i18n/notification-copy, which
 * takes the OS as an argument, so a stand-in OS below records what iOS would
 * be holding: the registered actions and the scheduled requests. The last test
 * reads notifications.ts to hold that it really does reword on every change.
 */

afterEach(() => setLocale('en'));

const COPY: Record<AppLocale, typeof en.notifications> = {
  en: en.notifications,
  fr: fr.notifications,
  ar: ar.notifications,
  zh: zh.notifications,
};

const IDS: NotificationIds = { category: 'quick-add', action: 'quick-add-log', nudge: 'daily-streak-nudge' };

interface Held {
  identifier: string;
  content: { title?: string | null; body?: string | null; categoryIdentifier?: string };
  trigger: unknown;
}

/** iOS, as far as these notifications go. Reports a daily trigger the way iOS does: as a calendar one. */
function fakeOS(options: { failCategories?: boolean } = {}) {
  const categories = new Map<string, Notifications.NotificationAction[]>();
  const scheduled = new Map<string, Held>();
  const calls = { schedule: 0, category: 0 };
  const os = {
    setNotificationCategoryAsync: async (id: string, actions: Notifications.NotificationAction[]) => {
      calls.category++;
      if (options.failCategories) throw new Error('UNNotificationCenter refused');
      categories.set(id, actions);
      return { identifier: id, actions };
    },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    scheduleNotificationAsync: async (req: Notifications.NotificationRequestInput) => {
      calls.schedule++;
      const trigger = req.trigger as { hour: number; minute: number };
      scheduled.set(req.identifier!, {
        identifier: req.identifier!,
        content: req.content as Held['content'],
        trigger: { type: 'calendar', repeats: true, dateComponents: { hour: trigger.hour, minute: trigger.minute } },
      });
      return req.identifier!;
    },
    cancelScheduledNotificationAsync: async (id: string) => {
      scheduled.delete(id);
    },
    SchedulableTriggerInputTypes: { DAILY: 'daily' },
  } as unknown as NotificationOS;
  return { os, categories, scheduled, calls };
}

test('localized errors: the lock-screen action and the streak nudge speak the app language', () => {
  for (const [lang, copy] of Object.entries(COPY) as [AppLocale, typeof en.notifications][]) {
    setLocale(lang);
    const action = quickAddAction(IDS.action);
    expect(action).toEqual({
      // The identifier is what iOS matches a response by; it never changes.
      identifier: 'quick-add-log',
      buttonTitle: copy.quickAddAction,
      textInput: {
        submitButtonTitle: copy.quickAddSave,
        placeholder: copy.quickAddPlaceholder,
      },
      options: { opensAppToForeground: false },
    });
    expect(streakNudgeContent()).toEqual({ title: copy.streakTitle, body: copy.streakBody });
    expect(notificationChannelName()).toBe(copy.channelName);
  }
  // And they really are translations, not English copied over.
  for (const lang of ['fr', 'ar', 'zh'] as const) {
    for (const key of Object.keys(en.notifications) as (keyof typeof en.notifications)[]) {
      expect([lang, key, COPY[lang][key] !== en.notifications[key]]).toEqual([lang, key, true]);
    }
  }
});

test('localized errors: a language change re-registers the action and rewords the scheduled nudge at its own time', async () => {
  const { os, categories, scheduled } = fakeOS();
  // Scheduled in English, for half past nine.
  setLocale('en');
  await setQuickAddCategory(os, IDS);
  await scheduleNudge(os, IDS, 21, 30);
  expect(scheduled.get(IDS.nudge)!.content.title).toBe(en.notifications.streakTitle);

  setLocale('fr');
  await rewordNotifications(os, IDS);

  expect(categories.get(IDS.category)!.map((a) => a.buttonTitle)).toEqual([fr.notifications.quickAddAction]);
  const nudge = scheduled.get(IDS.nudge)!;
  expect(nudge.content).toEqual({
    title: fr.notifications.streakTitle,
    body: fr.notifications.streakBody,
    // Still the category whose action it shows.
    categoryIdentifier: IDS.category,
  });
  // Same time as before: rewording is not rescheduling to the default.
  expect(nudgeTime(nudge.trigger)).toEqual({ hour: 21, minute: 30 });
  expect(scheduled.size).toBe(1);
});

test('a nudge already in the language is left alone, and none is created for a user without one', async () => {
  const none = fakeOS();
  setLocale('ar');
  await rewordNotifications(none.os, IDS);
  // The action is registered either way — the category has to exist for any
  // nudge delivered later — but no reminder appears that the user never set.
  expect(none.categories.get(IDS.category)![0]!.buttonTitle).toBe(ar.notifications.quickAddAction);
  expect(none.scheduled.size).toBe(0);
  expect(none.calls.schedule).toBe(0);

  const current = fakeOS();
  await scheduleNudge(current.os, IDS, 20, 0);
  await rewordNotifications(current.os, IDS);
  expect(current.calls.schedule).toBe(1);
});

test('localized errors: a refused action registration does not stop the nudge being reworded', async () => {
  const { os, scheduled } = fakeOS({ failCategories: true });
  setLocale('en');
  await scheduleNudge(os, IDS, 19, 15);
  setLocale('zh');
  // Never rejects: a language change has no one to report to.
  await rewordNotifications(os, IDS);
  expect(scheduled.get(IDS.nudge)!.content.title).toBe(zh.notifications.streakTitle);
  expect(nudgeTime(scheduled.get(IDS.nudge)!.trigger)).toEqual({ hour: 19, minute: 15 });
});

test('the time of a scheduled nudge is read from iOS and Android triggers alike', () => {
  expect(nudgeTime({ type: 'calendar', repeats: true, dateComponents: { hour: 7, minute: 45 } })).toEqual({ hour: 7, minute: 45 });
  expect(nudgeTime({ type: 'daily', hour: 22, minute: 5 })).toEqual({ hour: 22, minute: 5 });
  expect(nudgeTime({ type: 'calendar', dateComponents: { hour: 6 } })).toEqual({ hour: 6, minute: 0 });
  // Unreadable: the time every nudge has been scheduled for so far.
  expect(nudgeTime(null)).toEqual({ hour: 20, minute: 0 });
  expect(nudgeTime({ type: 'timeInterval', seconds: 60 })).toEqual({ hour: 20, minute: 0 });
});

test('a language listener hears each real change once', () => {
  const heard: string[] = [];
  const stop = onLocaleChange((locale) => heard.push(locale));
  const broken = onLocaleChange(() => {
    throw new Error('a listener that fails');
  });
  try {
    setLocale('en');
    setLocale('fr');
    // applyChosenLocale sets the same language twice; that is one change.
    setLocale('fr');
    setLocale('ar');
  } finally {
    stop();
    broken();
  }
  setLocale('zh');
  expect(heard).toEqual(['fr', 'ar']);
});

test('localized errors: notifications.ts hands the OS these words, and again on every language change', () => {
  const src = readFileSync(join(import.meta.dir, 'notifications.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  // The rewording is subscribed to the language, at import.
  expect(src).toMatch(/onLocaleChange\(\(\) => \{[\s\S]*?rewordNotifications\(Notifications, IDS\)[\s\S]*?\}\);/);
  // Registering and scheduling go through the same builders as the rewording.
  expect(src).toContain('setQuickAddCategory(Notifications, IDS)');
  expect(src).toContain('scheduleNudge(Notifications, IDS, hour, minute)');
  expect(src).toContain('name: notificationChannelName()');
  // Nothing worded by hand is left in it.
  expect(src).not.toMatch(/buttonTitle\s*:|title\s*:\s*['"`]|body\s*:\s*['"`]/);
});

// ── Subscription reminders ───────────────────────────────────────────────────

const SUBS: SubscriptionNotificationIds = {
  category: SUBSCRIPTION_CATEGORY,
  keep: SUBSCRIPTION_KEEP_ACTION,
  forgot: SUBSCRIPTION_FORGOT_ACTION,
};

interface HeldRequest {
  identifier: string;
  content: { title: string; body: string; categoryIdentifier?: string; data?: Record<string, unknown> };
  trigger: { type: string; date?: Date } | null;
}

/** The OS as the subscription reminders use it: pending requests, delivered ones, categories. */
function subsOS(pending: string[] = []) {
  const categories = new Map<string, Notifications.NotificationAction[]>();
  const scheduled = new Map<string, HeldRequest>();
  const delivered: HeldRequest[] = [];
  for (const identifier of pending) {
    scheduled.set(identifier, { identifier, content: { title: '', body: '' }, trigger: { type: 'date' } });
  }
  const os = {
    setNotificationCategoryAsync: async (id: string, actions: Notifications.NotificationAction[]) => {
      categories.set(id, actions);
      return { identifier: id, actions };
    },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    scheduleNotificationAsync: async (req: Notifications.NotificationRequestInput) => {
      const held = { identifier: req.identifier!, content: req.content, trigger: req.trigger } as unknown as HeldRequest;
      if (req.trigger === null) delivered.push(held);
      else scheduled.set(req.identifier!, held);
      return req.identifier!;
    },
    cancelScheduledNotificationAsync: async (id: string) => {
      scheduled.delete(id);
    },
    SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
  } as unknown as NotificationOS;
  return { os, categories, scheduled, delivered };
}

const renewal = (over: Partial<ScheduledReminder> = {}): ScheduledReminder => ({
  identifier: 'subs:renewal:sub_netflix:2026-10-20',
  kind: 'renewal',
  subscriptionId: 'sub_netflix',
  merchant: 'Netflix',
  amount: 13.49,
  currency: 'EUR',
  cadence: 'monthly',
  dueDate: '2026-10-20',
  fireDate: '2026-10-17',
  hour: 9,
  minute: 0,
  daysBefore: 3,
  ...over,
});

describe('reminder actions', () => {
  test('every subscription notification\u2019s category offers "Keep it" and "Did I forget?", in the app\u2019s language', async () => {
    for (const lang of ['en', 'fr', 'ar', 'zh'] as const) {
      setLocale(lang);
      const { os, categories } = subsOS();
      await setSubscriptionCategory(os, SUBS);
      expect(categories.get(SUBSCRIPTION_CATEGORY)).toEqual([
        { identifier: SUBSCRIPTION_KEEP_ACTION, buttonTitle: subsNotify[lang].actionKeep, options: { opensAppToForeground: true } },
        { identifier: SUBSCRIPTION_FORGOT_ACTION, buttonTitle: subsNotify[lang].actionForgot, options: { opensAppToForeground: true } },
      ]);
    }
  });

  test('a plan reaches the OS with the category, at the local hour, and data that opens the subscription', async () => {
    const { os, scheduled, delivered } = subsOS(['daily-streak-nudge', 'subs:renewal:sub_gone:2026-10-15']);
    const plan = planSubscriptionReminders({
      today: '2026-10-12',
      nowMinutes: 8 * 60,
      subscriptions: [
        { id: 'sub_netflix', merchantDisplay: 'Netflix', cadence: 'monthly', typicalAmount: 13.49, currency: 'EUR', status: 'active', nextExpectedAt: '2026-10-20' },
        { id: 'sub_canva', merchantDisplay: 'Canva', cadence: 'monthly', typicalAmount: 11.99, currency: 'USD', status: 'trial', nextExpectedAt: '2026-10-25', trialEndsAt: '2026-10-25' },
      ],
      events: [{ type: 'trial_found', subscriptionId: 'sub_canva', trialEndsAt: '2026-10-25' }],
    });
    const applied = await applySubscriptionPlan(os, SUBS, plan, 'user_a');

    // The reminder that is no longer planned is cancelled; the streak nudge is not ours to touch.
    expect(applied.cancelled).toEqual(['subs:renewal:sub_gone:2026-10-15']);
    expect([...scheduled.keys()].sort()).toEqual(
      ['daily-streak-nudge', 'subs:renewal:sub_netflix:2026-10-20', 'subs:trial:sub_canva:2026-10-25:1', 'subs:trial:sub_canva:2026-10-25:2'].sort(),
    );
    const netflix = scheduled.get('subs:renewal:sub_netflix:2026-10-20')!;
    expect(netflix.content.categoryIdentifier).toBe(SUBSCRIPTION_CATEGORY);
    expect(netflix.trigger!.type).toBe('date');
    // Nine in the morning of the 17th on the phone's own clock, whatever its zone.
    const at = netflix.trigger!.date!;
    expect([at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 10, 17, 9, 0]);
    // A tap, or either answer, opens Netflix; "Keep it" keeps it.
    expect(subscriptionResponse(DEFAULT_ACTION, netflix.content.data, 'user_a')!.route).toEqual({
      pathname: '/subscription-detail',
      params: { id: 'sub_netflix' },
    });
    expect(subscriptionResponse(SUBSCRIPTION_KEEP_ACTION, netflix.content.data, 'user_a')!.keep).toEqual(['sub_netflix']);

    // The trial found is shown at once, with the same two answers, and recorded.
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.content.categoryIdentifier).toBe(SUBSCRIPTION_CATEGORY);
    expect(subscriptionResponse(SUBSCRIPTION_FORGOT_ACTION, delivered[0]!.content.data, 'user_a')).toEqual({
      route: { pathname: '/subscription-detail', params: { id: 'sub_canva' } },
      keep: [],
    });
    expect(applied.ledgerKeys).toEqual(['trial:sub_canva:2026-10-25']);

    // Sign-out: every pending subscription reminder goes, nothing else.
    expect(await cancelSubscriptionReminders(os)).toBe(3);
    expect([...scheduled.keys()]).toEqual(['daily-streak-nudge']);
  });

  test('finds the user is looking at are recorded without being shown', async () => {
    const { os, delivered } = subsOS();
    const plan = planSubscriptionReminders({
      today: '2026-10-12',
      nowMinutes: 600,
      subscriptions: [{ id: 'sub_a', merchantDisplay: 'A', cadence: 'monthly', typicalAmount: 5, currency: 'USD', status: 'possible', nextExpectedAt: null }],
      events: [{ type: 'new', subscriptionId: 'sub_a' }],
      announceFinds: false,
    });
    const applied = await applySubscriptionPlan(os, SUBS, plan, 'user_a');
    expect(delivered).toEqual([]);
    expect(applied.ledgerKeys).toEqual(['new:sub_a']);
  });
});

describe('subscription reminders', () => {
  test('the words follow the app\u2019s language, with the amount in the subscription\u2019s own currency', () => {
    setLocale('en');
    expect(reminderContent(renewal())).toEqual({
      title: 'Netflix renews soon',
      body: '€13.49 a month, charged on Oct 20, in 3 days. Keep it, or did you forget?',
    });
    expect(reminderContent(renewal({ daysBefore: 1, cadence: 'yearly', amount: 99, currency: 'USD' }))).toEqual({
      title: 'Netflix: yearly renewal coming',
      body: '$99.00 a year, charged tomorrow. Keep it, or did you forget?',
    });
    setLocale('fr');
    const fr = reminderContent(renewal());
    expect(fr.title).toBe('Netflix se renouvelle bientôt');
    expect(fr.body).toContain('13,49');
    expect(fr.body).toContain('€');
    expect(fr.body).toContain('par mois');
    setLocale('ar');
    const ar = reminderContent(renewal({ kind: 'trial_ending', daysBefore: 2 }));
    expect(ar.title).toBe('تنتهي تجربة Netflix بعد يومين');
    setLocale('zh');
    expect(reminderContent(renewal({ amount: 0 })).body).toBe('10月20日（3 天后）续费。保留，还是忘了？');
  });

  test('a batch of finds names the first three and counts the rest', () => {
    setLocale('en');
    const items = ['Netflix', 'Spotify', 'Canva', 'Notion', 'Figma'].map((merchant, i) => ({
      subscriptionId: `sub_${i}`,
      merchant,
      amount: 10,
      currency: 'USD',
      cadence: 'monthly',
      trialEndsAt: null,
    }));
    const notice: Notice = { kind: 'found', identifier: 'x', show: true, ledgerKeys: [], subscriptionIds: items.map((i) => i.subscriptionId), items };
    expect(noticeContent(notice)).toEqual({
      title: '5 subscriptions found',
      body: 'Netflix, Spotify, Canva and 2 more. Keep them, or did you forget some?',
    });
    setLocale('ar');
    expect(noticeContent(notice).title).toBe('عُثر على 5 اشتراكات');
  });

  test('a price rise and a charge after cancelling say both amounts, and when', () => {
    setLocale('en');
    expect(
      noticeContent({ kind: 'price_rise', identifier: 'x', show: true, ledgerKeys: [], subscriptionIds: ['s'], merchant: 'Spotify', currency: 'GBP', from: 10.99, to: 11.99 }),
    ).toEqual({ title: 'Spotify went up', body: 'From £10.99 to £11.99. Keep it, or did you forget?' });
    expect(
      noticeContent({
        kind: 'charged_after_cancel',
        identifier: 'x',
        show: true,
        ledgerKeys: [],
        subscriptionIds: ['s'],
        merchant: 'Basic-Fit',
        currency: 'MAD',
        amount: 199,
        chargedAt: '2026-10-05',
      }).body,
      // Intl puts a no-break space between a currency code and its amount.
    ).toBe('MAD\u00a0199.00 on Oct 5, after you cancelled. Keep it, or did you forget to cancel?');
  });
});

describe('permission when useful', () => {
  const code = (f: string) =>
    readFileSync(join(import.meta.dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

  test('nothing at startup asks: push registration and the streak default only use permission already granted', () => {
    const src = code('notifications.ts');
    // The system prompt is shown from one place only.
    expect(src.match(/requestPermissionsAsync\(/g)).toHaveLength(1);
    const register = src.slice(src.indexOf('export async function registerForPushNotifications'));
    const registerBody = register.slice(0, register.indexOf('\n}\n'));
    expect(registerBody).not.toMatch(/ensurePermission|requestPermission|askForNotifications/);
    expect(registerBody).toMatch(/permissionState\(\)\)\.status !== 'granted'/);
    const streak = src.slice(src.indexOf('export async function applyDefaultStreakReminder'));
    expect(streak.slice(0, streak.indexOf('\n}\n'))).toMatch(/canSchedule: async \(\) => \(await permissionState\(\)\)\.status === 'granted'/);
    // The root layout asks for nothing itself.
    const layout = code('../app/_layout.tsx');
    expect(layout).not.toMatch(/requestPermissionsAsync|askForNotifications|scheduleStreakReminder\(/);
    expect(layout).toMatch(/registerSubscriptionCategory\(\)/);
  });

  test('the first prompt comes with the first reminder worth scheduling, in a moment the user is acting', () => {
    const src = code('notifications.ts');
    const plan = src.slice(src.indexOf('export async function scheduleSubscriptionReminders'));
    expect(plan.slice(0, plan.indexOf('\n}\n'))).toMatch(
      /permissionStep\(await permissionState\(\), request\.interactive && planIsWorthNotifying\(plan\)\)/,
    );
  });
});
