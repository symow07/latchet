/**
 * Links the system hands the app that are not screens.
 *
 * Signing in to Gmail or Outlook, and linking a bank through Plaid, happen in a
 * system browser session that ends by opening `latchet://email/connected…`
 * or `latchet://bank/linked…`. On iOS the browser session catches that link
 * itself. On Android the link also reaches expo-router, which has no such
 * route and would show "not found" over the screen the user started from.
 *
 * While the app is running, the browser session (expo-web-browser) is already
 * waiting for the link, so the router should do nothing. When the link starts
 * the app — Android stopped it while the browser was in front — there is no
 * session waiting, so go to the screen that shows the outcome.
 */

/** Where a cold start from each return link lands. */
const RETURN_LINKS: { pattern: RegExp; coldStartRoute: string }[] = [
  { pattern: /(^|[/:])email\/connected(?=$|[/?#])/, coldStartRoute: '/email-inbox' },
  { pattern: /(^|[/:])bank\/linked(?=$|[/?#])/, coldStartRoute: '/link-bank' },
];

/**
 * The route for a system path, for `+native-intent`'s redirectSystemPath.
 * '' tells expo-router not to navigate; any other path is left as it is.
 */
export function routeForSystemPath(path: string, initial: boolean): string {
  const bare = path.replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, '');
  for (const link of RETURN_LINKS) {
    if (link.pattern.test(bare)) return initial ? link.coldStartRoute : '';
  }
  return path;
}
