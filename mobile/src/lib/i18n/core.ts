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
import { enUS, fr as frLocale, zhCN, type Locale as DateFnsLocale } from 'date-fns/locale';

import en from './locales/en.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';

export const SUPPORTED_LOCALES = ['en', 'fr', 'zh'] as const;
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
};

const DATE_FNS_LOCALES: Record<AppLocale, DateFnsLocale> = {
  en: enUS,
  fr: frLocale,
  zh: zhCN,
};

/** BCP-47 tags for Intl (currency and number formatting). */
const INTL_TAGS: Record<AppLocale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  zh: 'zh-CN',
};

export const i18n = new I18n({ en, fr, zh });

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

let activeLocale: AppLocale = 'en';

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
  activeLocale = locale;
  i18n.locale = locale;
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
