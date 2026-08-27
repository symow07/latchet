/**
 * Which languages read right-to-left, and when that needs a restart.
 *
 * React Native decides layout direction natively, once, at startup.
 * `I18nManager.forceRTL` writes the preference but nothing already on screen
 * flips: the running app keeps the direction it launched with. Without
 * expo-updates there is no way to reload programmatically, so the honest
 * behaviour is to set the flag and tell the user, rather than switch the
 * language and leave the layout facing the wrong way with no explanation.
 *
 * Dependency-free so the decision can be tested; I18nManager itself is touched
 * in bootstrap.
 */
import type { AppLocale } from './core';

const RTL_LOCALES = new Set<AppLocale>(['ar']);

export function isRtlLocale(locale: AppLocale): boolean {
  return RTL_LOCALES.has(locale);
}

/**
 * True when switching to this locale changes the layout direction, and the app
 * therefore has to be restarted before it looks right.
 *
 * Switching Arabic → Arabic, or French → English, changes nothing: both sides
 * read the same way and the running layout is already correct.
 */
export function rtlRestartRequired(next: AppLocale, currentlyRtl: boolean): boolean {
  return isRtlLocale(next) !== currentlyRtl;
}
