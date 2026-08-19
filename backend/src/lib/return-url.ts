/**
 * Deep-link return URLs, validated.
 *
 * The OAuth callback took `returnUrl` off the query string and redirected to
 * `${returnUrl}?status=success&email=<the user's email>`. With no allowlist,
 * anyone could hand a user a link that leaked their email address — and the
 * OAuth `code` flow's outcome — to any host they chose.
 */

/** Schemes the app itself owns. Anything else is someone else's destination. */
export const APP_SCHEMES = ["realbudget:"];

/**
 * Return `candidate` when it is one of our own deep links, otherwise `fallback`.
 * Rejects on unknown scheme, unparseable input, and embedded credentials.
 */
export function safeReturnUrl(
  candidate: string | null | undefined,
  fallback: string,
  allowedSchemes: string[] = APP_SCHEMES
): string {
  if (!candidate) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return fallback;
  }

  if (!allowedSchemes.includes(parsed.protocol)) return fallback;
  // user:pass@ in a redirect target is only ever an attempt to confuse.
  if (parsed.username || parsed.password) return fallback;

  return candidate;
}
