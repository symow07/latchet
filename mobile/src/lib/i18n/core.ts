/**
 * Localisation core — everything except device detection.
 *
 * Dependency-free (no native modules) so the real configuration, including the
 * plural rules, is what gets unit-tested. index.ts adds device-locale detection
 * on top via expo-localization.
 *
 * `en` is the source of truth: every other file derives from it, and a missing
 * key falls back to English rather than showing a raw key to a user.
 */
import { I18n } from 'i18n-js';
import { enUS, fr as frLocale, zhCN, ar as arLocale, type Locale as DateFnsLocale } from 'date-fns/locale';

import en from './locales/en.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';
import ar from './locales/ar.json';

export const SUPPORTED_LOCALES = ['en', 'fr', 'zh', 'ar'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<AppLocale, string> = {
  // Each in its own language — someone looking for their language should not
  // have to read English to find it.
  en: 'English',
  fr: 'Français',
  // Named as Simplified rather than just "中文". The strings are Simplified,
  // and a Traditional reader choosing an unqualified "Chinese" and getting
  // Simplified has been misled; choosing "简体中文" and getting it has not.
  zh: '简体中文',
  ar: 'العربية',
};

const DATE_FNS_LOCALES: Record<AppLocale, DateFnsLocale> = {
  en: enUS,
  fr: frLocale,
  zh: zhCN,
  ar: arLocale,
};

/** BCP-47 tags for Intl (currency and number formatting). */
const INTL_TAGS: Record<AppLocale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  zh: 'zh-CN',
  // Morocco rather than a generic ar: this app's import screen names CIH and
  // Attijariwafa, and ar-MA formats currency and dates the way its users read
  // them. ar-MA also uses Western digits, which ar-EG would not.
  ar: 'ar-MA',
};

export const i18n = new I18n({ en, fr, zh, ar });

i18n.enableFallback = true;
i18n.defaultLocale = 'en';

/**
 * Plural rules, which differ in ways string concatenation cannot express.
 *
 * French treats zero as singular — "0 jour", not "0 jours" — where English does
 * the opposite. Chinese has no plural forms at all. The default one/other rule
 * is therefore wrong in two of the three languages we ship.
 *
 * A `zero` key, where a locale defines one, always wins for count 0: "No
 * transactions" reads better than "0 transactions" in any language.
 */
i18n.pluralization.register('en', (_i18n, count) => {
  if (count === 0) return ['zero', 'other'];
  return count === 1 ? ['one', 'other'] : ['other'];
});

i18n.pluralization.register('fr', (_i18n, count) => {
  if (count === 0) return ['zero', 'one', 'other'];
  if (count === 1) return ['one', 'other'];
  return ['other'];
});

i18n.pluralization.register('zh', (_i18n, count) =>
  count === 0 ? ['zero', 'other'] : ['other']
);

/**
 * Arabic, which has six forms where English has two.
 *
 * CLDR: 0 is zero, 1 is one, 2 is two, 3–10 is few, 11–99 is many, and
 * everything else — 100, 101, 1000 — is other. The bands repeat every hundred,
 * so 103 is few and 111 is many.
 *
 * This is why the Arabic strings could not simply be translated over the
 * English keys: "%{count} transactions" needs a different noun form for 3, for
 * 15 and for 100, and a two-form key cannot express that. Each form falls
 * through to `other`, so a key that only defines `other` still renders — it is
 * just less correct, not broken.
 */
i18n.pluralization.register('ar', (_i18n, count) => {
  if (count === 0) return ['zero', 'other'];
  if (count === 1) return ['one', 'other'];
  if (count === 2) return ['two', 'other'];
  const within = count % 100;
  if (within >= 3 && within <= 10) return ['few', 'other'];
  if (within >= 11 && within <= 99) return ['many', 'other'];
  return ['other'];
});

let activeLocale: AppLocale = 'en';

/**
 * Who wants to know when the language changes.
 *
 * Most text is read through t() when it is drawn, and the remount the locale
 * store triggers takes care of it. A few words are handed to the operating
 * system once and kept there — the lock-screen action's button, a nudge
 * scheduled for tonight — and nothing redraws those. Their owners listen here
 * and hand the system the new words.
 */
type LocaleListener = (locale: AppLocale) => void;
const localeListeners = new Set<LocaleListener>();

/** Call `listener` after every change of language. Returns the unsubscribe. */
export function onLocaleChange(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

/** Narrow an arbitrary tag ("fr-CA", "zh-Hant-TW") to a locale we ship. */
/**
 * Narrow a device tag to a language we ship.
 *
 * `zh-Hant` narrows to `zh`, which is Simplified. That is deliberate: shipping
 * a machine-converted Traditional locale would mean 900 strings nobody has
 * read, and script conversion does not fix the vocabulary that actually
 * differs — 軟體 against 软件, 網路 against 网络. A Traditional reader gets
 * Simplified, which they can read, and the picker says which one it is.
 */
export function normalizeLocale(tag: string | null | undefined): AppLocale | null {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base ?? '')
    ? (base as AppLocale)
    : null;
}

export function setLocale(locale: AppLocale): void {
  const changed = locale !== activeLocale;
  activeLocale = locale;
  i18n.locale = locale;
  // Only a real change: applyChosenLocale sets the same language twice on
  // purpose, and the listeners re-register things with the OS.
  if (!changed) return;
  for (const listener of [...localeListeners]) {
    try {
      listener(locale);
    } catch (e) {
      // A listener's failure is its own; the language has already changed.
      console.warn('[i18n] a locale listener failed:', e);
    }
  }
}

export function getLocale(): AppLocale {
  return activeLocale;
}

export function getDateFnsLocale(): DateFnsLocale {
  return DATE_FNS_LOCALES[activeLocale];
}

export function getIntlTag(): string {
  return INTL_TAGS[activeLocale];
}

/**
 * Translate a key.
 *
 * Pass `count` for anything countable and let i18n-js choose the form, rather
 * than appending an "s" — see the plural rules above.
 */
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

setLocale('en');
