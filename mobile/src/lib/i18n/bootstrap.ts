/**
 * Choosing the language, at startup and when a user's data opens.
 *
 * The device language is only ever the *first-run default*. Once the user has
 * picked — even if they picked the same one — their choice wins and follows
 * their account, so a French user on an English phone stays in French.
 *
 * Two moments, because the account's choice lives in its own database, which
 * is only open once someone is signed in:
 *   initDeviceLocale()  at launch, before anyone is known: the language this
 *                       phone last showed (a device key), else the phone's own.
 *                       This is what the login screen is in.
 *   applyUserLocale()   once a user's database is active: their account's
 *                       language, if the account has one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applySettingsDefaults, getSettings, isSettingsDefault, updateSettings } from '../db';
import { deviceLocale } from './index';
import { getLocale, setLocale, normalizeLocale, type AppLocale } from './core';
import { applyChosenLocale } from './apply';
import { I18nManager } from 'react-native';
import { isRtlLocale, rtlRestartRequired } from './rtl';

/**
 * Device key (storage-keys.ts): the language this phone last showed. Holds the
 * locale code; older installs wrote '1', which normalizes to nothing and so
 * falls back to the phone's language until a user's own choice is applied.
 */
const CHOSEN_KEY = '@locale_chosen_v1';

/** At launch: the phone's last language, else the device's. Reads no database. */
export async function initDeviceLocale(): Promise<AppLocale> {
  try {
    const locale = normalizeLocale(await AsyncStorage.getItem(CHOSEN_KEY)) ?? deviceLocale();
    setLocale(locale);
    applyLayoutDirection(locale);
    return locale;
  } catch {
    setLocale('en');
    return 'en';
  }
}

/**
 * Once a user's database is active: apply the language their account chose.
 *
 * An account nobody has configured yet (its settings row is still the seeded
 * default) keeps the language on screen, and records it as a *default* — at
 * the epoch, through applySettingsDefaults — never through updateSettings,
 * which would stamp the whole row as a fresh edit and, on the next sync,
 * overwrite the budget the user set up on another phone with zeros.
 */
export async function applyUserLocale(): Promise<AppLocale> {
  const showing = getLocale();
  try {
    if (await isSettingsDefault()) {
      await applySettingsDefaults({ locale: showing });
      return showing;
    }
    const chosen = normalizeLocale((await getSettings())?.locale);
    if (!chosen) return showing;
    setLocale(chosen);
    applyLayoutDirection(chosen);
    await AsyncStorage.setItem(CHOSEN_KEY, chosen).catch(() => {});
    return chosen;
  } catch {
    return showing;
  }
}

/** Persist a language the user picked and apply it immediately. */
export async function chooseLocale(locale: AppLocale): Promise<boolean> {
  // Whether the layout direction changed, so the caller can say so. Read
  // before the flag is written, or it always compares equal to itself.
  const restartNeeded = rtlRestartRequired(locale, I18nManager.isRTL);

  await applyChosenLocale(locale, async (chosen) => {
    await AsyncStorage.setItem(CHOSEN_KEY, chosen).catch(() => {});
    await updateSettings({ locale: chosen }).catch(() => {});
  });

  applyLayoutDirection(locale);
  return restartNeeded;
}

/**
 * Tell React Native which way this language reads.
 *
 * Nothing already on screen moves: direction is decided natively at launch, so
 * this takes effect the next time the app starts. allowRTL must be on or
 * forceRTL is ignored outright.
 */
export function applyLayoutDirection(locale: AppLocale): void {
  const rtl = isRtlLocale(locale);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
}
