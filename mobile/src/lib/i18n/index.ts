/**
 * Localisation.
 *
 * Everything except device detection lives in ./core, which imports nothing
 * native so the configuration itself can be unit-tested.
 */
import { getLocales } from 'expo-localization';
import { normalizeLocale, type AppLocale } from './core';

export {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  normalizeLocale,
  setLocale,
  getLocale,
  getDateFnsLocale,
  getIntlTag,
  t,
  i18n,
  type AppLocale,
} from './core';

/** The device's preferred language, if we ship it. */
export function deviceLocale(): AppLocale {
  for (const locale of getLocales()) {
    const match = normalizeLocale(locale.languageCode ?? locale.languageTag);
    if (match) return match;
  }
  return 'en';
}
