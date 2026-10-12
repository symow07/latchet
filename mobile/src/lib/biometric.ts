import * as LocalAuthentication from 'expo-local-authentication';
import { t } from '@/lib/i18n/core';

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return isEnrolled;
  } catch {
    return false;
  }
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  try {
    // The reason is ours to word, so it comes from the locales. The fallback and
    // cancel buttons are left to iOS: unset, it titles them itself ("Enter
    // Passcode", "Cancel") in the device's language, where hard-coded labels
    // would stay English in a translated app.
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('startup.authenticate'),
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
