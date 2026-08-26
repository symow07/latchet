/**
 * Applying a chosen language around the write that persists it.
 *
 * Split out of bootstrap.ts so it can be tested: bootstrap imports the
 * database, which imports expo-sqlite, which cannot load outside a simulator.
 * This module imports nothing but the locale itself.
 *
 * The double application is the whole point. Persisting the choice goes
 * through the settings row, and reading that row used to re-apply the language
 * it still held — so the new language was set, then immediately undone, and
 * the interface stayed in the old one while the database happily recorded the
 * new one. Setting it again afterwards means no side effect anywhere in the
 * persistence path can win that race.
 */
import { setLocale, type AppLocale } from './core';

export async function applyChosenLocale(
  locale: AppLocale,
  persist: (locale: AppLocale) => Promise<void>,
): Promise<void> {
  // Up front, so anything that renders during the write already sees it.
  setLocale(locale);
  await persist(locale).catch(() => {});
  // And after, so nothing the write touched can put it back.
  setLocale(locale);
}
