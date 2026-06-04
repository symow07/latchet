/**
 * Pure mapping helpers translating Plaid's vocabulary into the app's. Kept in a
 * dependency-free module so they can be unit-tested without booting auth/prisma.
 */

/** Map a Plaid account type/subtype to the app's account-type vocabulary. */
export function mapAccountType(type?: string, subtype?: string): string {
  if (type === "credit") return "credit";
  if (type === "investment") return "investment";
  if (subtype === "savings") return "savings";
  if (subtype === "checking") return "checking";
  return "other";
}

/** Map a Plaid transaction's category array to the app's category vocabulary. */
export function mapCategory(plaidCategories?: string[] | null): string {
  const c = (plaidCategories ?? []).join(" ").toLowerCase();
  if (/food|restaurant|grocer|coffee|dining/.test(c)) return "Food";
  if (/transit|travel|gas|uber|taxi|transport/.test(c)) return "Transport";
  if (/shop|merchandise|store|retail/.test(c)) return "Shopping";
  if (/gym|fitness|recreation/.test(c)) return "Gym";
  if (/subscription|service|software/.test(c)) return "Subscriptions";
  return "Other";
}
