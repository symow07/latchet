/**
 * Pure mapping helpers translating Plaid's vocabulary into the app's. Kept in a
 * dependency-free module so they can be unit-tested without booting auth/prisma.
 *
 * The app's built-in categories are Food, Gym, Transport, Shopping,
 * Subscriptions and Other (mobile/src/lib/category-meta.ts). Every mapping
 * here lands on one of those six, following the same calls the phone's own
 * keyword table makes for the same things: a convenience store is Food, car
 * repair is Transport, phone and broadband bills are Subscriptions.
 */

/** Map a Plaid account type/subtype to the app's account-type vocabulary. */
export function mapAccountType(type?: string, subtype?: string): string {
  if (type === "credit") return "credit";
  if (type === "investment") return "investment";
  if (subtype === "savings") return "savings";
  if (subtype === "checking") return "checking";
  return "other";
}

/**
 * Map a Plaid transaction's legacy `category` array to the app's vocabulary.
 *
 * Plaid deprecated this hierarchy in favour of personal_finance_category; it
 * is only read for a transaction that carries no personal_finance_category.
 */
export function mapCategory(plaidCategories?: string[] | null): string {
  const c = (plaidCategories ?? []).join(" ").toLowerCase();
  if (/food|restaurant|grocer|coffee|dining/.test(c)) return "Food";
  if (/transit|travel|gas|uber|taxi|transport/.test(c)) return "Transport";
  if (/shop|merchandise|store|retail/.test(c)) return "Shopping";
  if (/gym|fitness|recreation/.test(c)) return "Gym";
  if (/subscription|service|software/.test(c)) return "Subscriptions";
  return "Other";
}

/**
 * Detailed codes that do not follow their primary's mapping. Taxonomy v1 and
 * v2 share every spending primary and these detailed codes; v2 only adds
 * income, loan and transfer detail, all of which is Other here.
 */
const DETAILED: Record<string, string> = {
  // A convenience store sells mostly food and drink.
  GENERAL_MERCHANDISE_CONVENIENCE_STORES: "Food",
  // Bought things, sold in shops.
  HOME_IMPROVEMENT_FURNITURE: "Shopping",
  HOME_IMPROVEMENT_HARDWARE: "Shopping",
  ENTERTAINMENT_VIDEO_GAMES: "Shopping",
  // Getting somewhere.
  TRAVEL_FLIGHTS: "Transport",
  TRAVEL_RENTAL_CARS: "Transport",
  GENERAL_SERVICES_AUTOMOTIVE: "Transport",
  // Paid every month for a service: streaming, music, phone, broadband.
  ENTERTAINMENT_TV_AND_MOVIES: "Subscriptions",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "Subscriptions",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "Subscriptions",
  RENT_AND_UTILITIES_TELEPHONE: "Subscriptions",
  // Gyms are their own category; the rest of personal care is not.
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: "Gym",
};

/** Primaries whose every detailed code (bar the ones above) maps one way. */
const PRIMARY: Record<string, string> = {
  FOOD_AND_DRINK: "Food",
  GENERAL_MERCHANDISE: "Shopping",
  TRANSPORTATION: "Transport",
};

/** The fields of Plaid's personal_finance_category this module reads. */
export interface PersonalFinanceCategory {
  primary?: string | null;
  detailed?: string | null;
}

/**
 * Map Plaid's personal_finance_category to the app's vocabulary, or null when
 * the transaction carries none (then the legacy array is the fallback).
 *
 * The detailed code decides when it is one the app treats differently from
 * its primary; otherwise the primary does. Anything else — income, transfers,
 * loan payments, fees, rent and utilities, medical, travel lodging, a primary
 * added after this was written — is Other: a wrong guess costs the user a
 * correction, and Other is the one they expect to sort themselves.
 */
export function mapPersonalFinanceCategory(pfc: PersonalFinanceCategory | null | undefined): string | null {
  const primary = typeof pfc?.primary === "string" ? pfc.primary.trim().toUpperCase() : "";
  const detailed = typeof pfc?.detailed === "string" ? pfc.detailed.trim().toUpperCase() : "";
  if (!primary && !detailed) return null;
  if (detailed && DETAILED[detailed]) return DETAILED[detailed]!;
  // A detailed code always starts with its primary, so a lone detailed code
  // still names one.
  const p = primary || Object.keys(PRIMARY).find((k) => detailed.startsWith(`${k}_`)) || "";
  return PRIMARY[p] ?? "Other";
}

/**
 * The app category for one Plaid transaction: personal_finance_category when
 * present, the legacy `category` array only when it is absent.
 */
export function categoryForTransaction(t: {
  personal_finance_category?: PersonalFinanceCategory | null;
  category?: string[] | null;
}): string {
  return mapPersonalFinanceCategory(t.personal_finance_category) ?? mapCategory(t.category);
}
