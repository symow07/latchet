/**
 * Which profile's screens an account may be on, and where to send it if not.
 *
 * Personal and business are two tab groups, `(tabs)` and `(business-tabs)`,
 * and both have an `index`, so both map to "/". Expo Router resolves an
 * ambiguous "/" to one of them, and on a cold start that was the business
 * group: a personal account opened on the business tabs. The gate in the root
 * layout only ever redirected business accounts, on the assumption that "/"
 * meant personal. This module removes the assumption: the gate asks it, with
 * the route the app is actually on, and redirects whichever way is needed.
 *
 * Dependency-free, so `bun test` can hold the rules (profile-route.test.ts).
 */

export type AccountType = 'personal' | 'business';

export type ProfileRedirect = '/account-type' | '/(tabs)' | '/(business-tabs)';

/** Screens that belong to the business profile alone. */
const BUSINESS_ONLY = new Set([
  '(business-tabs)',
  'business-profile',
  'business-tax',
  'business-team',
  'business-tools',
]);

/**
 * Where an emailed link lands. They belong to no profile and must open for any
 * account — including a brand-new one with no profile yet, which is exactly
 * who opens the verification link sent at sign-up. Sending them to the picker
 * would swallow the link.
 *
 * forgot-password is not one: it is a signed-out screen, declared with login
 * in the root layout's public group, so signing in closes it like sign-in
 * itself. Left exempt here and outside the guards, it outlived a sign-in and
 * stayed on top of the app.
 */
const AUTH_LANDINGS = new Set(['reset-password', 'verify-email']);

/**
 * Where a signed-in account on `segments` should be sent, or null to stay.
 *
 * `segments` is Expo Router's `useSegments()`: the first entry is the group
 * or top-level screen, e.g. ['(business-tabs)', 'expenses'] or ['accounts'].
 *
 *   an auth landing  → stays, for every profile (AUTH_LANDINGS)
 *   no profile yet   → the profile picker, unless already on it
 *   personal         → its tabs, from anything that belongs to business
 *   business         → its tabs, from the personal tabs or the picker
 *
 * Everything else stays put: a pushed screen both profiles use, a deep link,
 * onboarding. Redirecting from those would throw the person out of where they
 * were going.
 */
export function profileRedirect(
  accountType: AccountType | null,
  segments: readonly string[],
): ProfileRedirect | null {
  const top = segments[0] ?? '';
  if (AUTH_LANDINGS.has(top)) return null;
  if (!accountType) return top === 'account-type' ? null : '/account-type';
  if (accountType === 'personal') return BUSINESS_ONLY.has(top) ? '/(tabs)' : null;
  // Business. The picker is included because choosing Business there is
  // completed by this redirect, as it always was.
  return top === '(tabs)' || top === 'account-type' ? '/(business-tabs)' : null;
}
