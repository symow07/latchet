/**
 * The App Group container, as seen from JavaScript.
 *
 * iOS only. Everywhere else — Android, web, and any build where the App Group
 * entitlement has not been provisioned — this returns null and the sharing
 * feature simply does not appear.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** Must match the entitlement in plugins/withShareExtension.js. */
export const APP_GROUP = 'group.com.realbudget.app';

interface AppGroupNativeModule {
  containerPath(identifier: string): string | null;
}

const native = requireOptionalNativeModule<AppGroupNativeModule>('AppGroup');

/**
 * Absolute path to the shared container, or null when it is unavailable.
 *
 * Optional on purpose: requireOptionalNativeModule returns null rather than
 * throwing if the native side is missing, so a JS-only reload or a build
 * without the module degrades to "no shared inbox" instead of a crash.
 */
export function appGroupPath(): string | null {
  if (Platform.OS !== 'ios' || !native) return null;
  try {
    return native.containerPath(APP_GROUP);
  } catch {
    return null;
  }
}
