import { routeForSystemPath } from '@/lib/system-links';

/**
 * expo-router's hook for links the system opens the app with. The Gmail,
 * Outlook and Plaid return links are not screens; lib/system-links.ts says why
 * and where they go.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    return routeForSystemPath(path, initial);
  } catch {
    // A throw here can crash the app at launch; an unchanged path cannot.
    return path;
  }
}
