/**
 * Choosing the language at startup.
 *
 * The device language is only ever the *first-run default*. Once the user has
 * picked — even if they picked the same one — their choice wins and follows
 * their account, so a French user on an English phone stays in French.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSettings, updateSettings } from '../db';
import { deviceLocale } from './index';
import { setLocale, normalizeLocale, type AppLocale } from './core';
import { applyChosenLocale } from './apply';
import { I18nManager } from 'react-native';
import { isRtlLocale, rtlRestartRequired } from './rtl';

const CHOSEN_KEY = '@locale_chosen_v1';

/** Apply the stored language, falling back to the device on first run. */
export async function initLocale(): Promise<AppLocale> {
  try {
    const chosen = await AsyncStorage.getItem(CHOSEN_KEY);

    if (chosen) {
      const stored = normalizeLocale((await getSettings())?.locale) ?? 'en';
      setLocale(stored);
      applyLayoutDirection(stored);
      return stored;
    }

    // First run: take the device's language if we ship it, and record it so
    // changing the phone's language later does not silently override a choice.
    const fromDevice = deviceLocale();
    setLocale(fromDevice);
    applyLayoutDirection(fromDevice);
    await updateSettings({ locale: fromDevice }).catch(() => {});
    await AsyncStorage.setItem(CHOSEN_KEY, '1');
    return fromDevice;
  } catch {
    setLocale('en');
    return 'en';
  }
}

/** Persist a language the user picked and apply it immediately. */
export async function chooseLocale(locale: AppLocale): Promise<boolean> {
  // Whether the layout direction changed, so the caller can say so. Read
  // before the flag is written, or it always compares equal to itself.
  const restartNeeded = rtlRestartRequired(locale, I18nManager.isRTL);

  await applyChosenLocale(locale, async (chosen) => {
    await AsyncStorage.setItem(CHOSEN_KEY, '1').catch(() => {});
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
