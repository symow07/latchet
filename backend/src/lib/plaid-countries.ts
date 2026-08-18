/**
 * Which Plaid country codes to open Link with.
 *
 * Plaid Transactions covers 20 countries. Hardcoding ["US"] meant a French or
 * Irish user was shown US institutions only. But requesting a country the
 * Plaid account is not enabled for is an error, so the answer is the
 * intersection of "where this user probably banks" and "what we are enabled
 * for" (PLAID_COUNTRY_CODES).
 */

/** Every country Plaid's Transactions product supports. */
export const PLAID_SUPPORTED_COUNTRIES = [
  "US", "CA",
  "AT", "BE", "DK", "EE", "FI", "FR", "DE", "IE", "IT",
  "LV", "LT", "NL", "NO", "PL", "PT", "ES", "SE", "GB",
] as const;

/** Currency → the supported countries that use it. */
const CURRENCY_COUNTRIES: Record<string, string[]> = {
  USD: ["US"],
  CAD: ["CA"],
  GBP: ["GB"],
  DKK: ["DK"],
  NOK: ["NO"],
  SEK: ["SE"],
  PLN: ["PL"],
  EUR: ["AT", "BE", "EE", "FI", "FR", "DE", "IE", "IT", "LV", "LT", "NL", "PT", "ES"],
};

/** Parse the operator's enabled-country list, keeping only real Plaid codes. */
export function parseEnabledCountries(raw: string | undefined): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is string =>
      (PLAID_SUPPORTED_COUNTRIES as readonly string[]).includes(c)
    );
  return parsed.length > 0 ? parsed : ["US"];
}

/**
 * Country codes for a Link session.
 *
 * Falls back to the full enabled list when the user's currency maps to nothing
 * we are enabled for — better to show every institution we can than to
 * silently show only US ones.
 */
export function countryCodesForCurrency(
  currency: string | null | undefined,
  enabled: string[]
): string[] {
  const preferred = CURRENCY_COUNTRIES[(currency ?? "").toUpperCase()];
  if (!preferred) return enabled;

  const intersection = preferred.filter((c) => enabled.includes(c));
  return intersection.length > 0 ? intersection : enabled;
}
