/**
 * Which Plaid country codes to open Link with.
 *
 * Plaid serves 20 countries: the US, Canada, the UK and 17 in the EU and EEA.
 * Hardcoding ["US"] meant a French or Irish user was shown US institutions
 * only. But requesting a country this Plaid account is not enabled for is an
 * error, so the answer is the intersection of "where this user probably
 * banks" and "what we are enabled for" (PLAID_COUNTRY_CODES).
 *
 * "Where this user banks" is the phone's region first — a French phone banks
 * in France whatever currency the app is set to — then the app's currency,
 * which narrows a euro user to the euro area. Dependency-free and pure.
 */

/** Every country Plaid Link accepts in `country_codes` (Plaid API reference). */
export const PLAID_SUPPORTED_COUNTRIES = [
  "US", "CA", "GB",
  "AT", "BE", "DK", "EE", "FI", "FR", "DE", "IE", "IT",
  "LV", "LT", "NL", "NO", "PL", "PT", "ES", "SE",
] as const;

export type PlaidCountry = (typeof PLAID_SUPPORTED_COUNTRIES)[number];

const SUPPORTED = new Set<string>(PLAID_SUPPORTED_COUNTRIES);

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

/**
 * A region as Plaid spells it, or null. Devices report ISO 3166-1 alpha-2, but
 * "UK" is common in hand-written settings and means GB. Anything that is not
 * two letters is not a region.
 */
export function normalizeRegion(region: string | null | undefined): string | null {
  const code = (region ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code === "UK" ? "GB" : code;
}

/** True when Plaid serves this region at all, enabled here or not. */
export function isPlaidCountry(region: string | null | undefined): boolean {
  const code = normalizeRegion(region);
  return code !== null && SUPPORTED.has(code);
}

/**
 * Parse the operator's enabled-country list, keeping only real Plaid codes, in
 * the operator's order and without repeats. An empty or nonsense list means
 * the US, Plaid's own default.
 */
export function parseEnabledCountries(raw: string | undefined): string[] {
  const parsed: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const code = normalizeRegion(part);
    if (code && SUPPORTED.has(code) && !parsed.includes(code)) parsed.push(code);
  }
  return parsed.length > 0 ? parsed : ["US"];
}

/**
 * Country codes for a Link session from the currency alone.
 *
 * Falls back to the full enabled list when the user's currency maps to nothing
 * we are enabled for — better to show every institution we can than to
 * silently show only US ones.
 */
export function countryCodesForCurrency(
  currency: string | null | undefined,
  enabled: string[]
): string[] {
  const preferred = CURRENCY_COUNTRIES[(currency ?? "").trim().toUpperCase()];
  if (!preferred) return enabled;

  const intersection = preferred.filter((c) => enabled.includes(c));
  return intersection.length > 0 ? intersection : enabled;
}

/**
 * Country codes for a Link session: the phone's region when we serve it, else
 * the countries of the app's currency that we serve, else everything enabled.
 *
 * Never empty — Plaid requires at least one code — and never a country outside
 * `enabled`, which Plaid would reject.
 */
export function countryCodesForLink(
  user: { region?: string | null; currency?: string | null },
  enabled: string[]
): string[] {
  const allowed = enabled.length > 0 ? enabled : ["US"];
  const region = normalizeRegion(user.region);
  if (region && allowed.includes(region)) return [region];
  return countryCodesForCurrency(user.currency, allowed);
}

/**
 * Plaid Link's display language for the app's language. Link speaks English
 * and French among the app's four; Chinese and Arabic readers get English,
 * which Link falls back to anyway.
 */
export function linkLanguage(appLanguage: string | null | undefined): "en" | "fr" {
  return (appLanguage ?? "").trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}
