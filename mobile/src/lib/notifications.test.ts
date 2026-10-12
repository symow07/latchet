import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as Notifications from 'expo-notifications';
import en from './i18n/locales/en.json';
import fr from './i18n/locales/fr.json';
import ar from './i18n/locales/ar.json';
import zh from './i18n/locales/zh.json';
import { onLocaleChange, setLocale, type AppLocale } from './i18n/core';
import {
  notificationChannelName,
  nudgeTime,
  quickAddAction,
  rewordNotifications,
  scheduleNudge,
  setQuickAddCategory,
  streakNudgeContent,
  type NotificationIds,
  type NotificationOS,
} from './i18n/notification-copy';

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
