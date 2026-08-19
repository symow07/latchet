import type { BankProvider } from "./types";
import { plaidProvider } from "./plaid";

export * from "./types";
export { plaidProvider };

/**
 * Registry of bank-sync providers.
 *
 * Plaid is the only entry today. Adding Salt Edge (73 countries) or TrueLayer
 * (64) means implementing BankProvider and adding it here — the persistence in
 * lib/bank-sync.ts and the routes above it do not change.
 */
const PROVIDERS: Record<string, BankProvider> = {
  [plaidProvider.id]: plaidProvider,
};

/** The provider used for new connections when none is specified. */
export const DEFAULT_PROVIDER_ID = plaidProvider.id;

export function getProvider(id: string = DEFAULT_PROVIDER_ID): BankProvider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown bank provider: ${id}`);
  return provider;
}

/** Every registered provider, for diagnostics and future provider pickers. */
export function listProviders(): BankProvider[] {
  return Object.values(PROVIDERS);
}
