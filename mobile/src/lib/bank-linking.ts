/**
 * Bank Linking Infrastructure
 * Handles secure bank connections via Open Banking APIs
 * Uses OAuth-based authentication with no password storage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api/api';
import { requestPull } from './cloud-sync';
import { userKey } from './storage-keys';

// Bank connections write to this user's ledger on the server: the exchange
// runs an initial transaction sync, a bank sync books new transactions, and a
// disconnect deletes the bank's. None of it reaches the phone until it pulls,
// so each of those asks for a pull as soon as the server is done.

// ── Backend (Plaid) wire types + mappers ─────────────────────────────────────
interface PlaidAccountDTO {
  id: string;
  plaidAccountId: string;
  name: string;
  type: string;
  mask?: string | null;
  balance: number;
  currency: string;
  isEnabled: boolean;
}
interface PlaidItemDTO {
  id: string;
  institutionName?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  accounts: PlaidAccountDTO[];
}

function mapAccountType(t: string): LinkedAccount['type'] {
  if (t === 'credit' || t === 'investment' || t === 'savings') return t;
  if (t === 'checking') return 'checking';
  return 'checking';
}

/** PSD2 re-consent runs to 90 days; used only for the renewal reminder. */
const CONSENT_ESTIMATE_DAYS = 90;

function itemToBank(item: PlaidItemDTO): LinkedBank {
  return {
    id: item.id,
    institutionName: item.institutionName ?? 'Bank',
    lastSynced: item.updatedAt,
    connectionStatus: item.status === 'active' ? 'active' : 'error',
    accountsCount: item.accounts.length,
    // Estimated from when the connection was made. It used to be derived from
    // updatedAt, which the sync rewrites on every run — so the expiry rolled
    // forward forever and no connection ever appeared to expire, making
    // checkConnectionHealth permanently report everything healthy.
    //
    // This is still an estimate: the authoritative value is Plaid's
    // item.consent_expiration_time, which we do not yet store.
    consentExpiresAt: new Date(
      new Date(item.createdAt).getTime() + CONSENT_ESTIMATE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString(),
  };
}

function accountToLinked(item: PlaidItemDTO, a: PlaidAccountDTO): LinkedAccount {
  return {
    id: a.plaidAccountId,
    bankId: item.id,
    name: a.name,
    type: mapAccountType(a.type),
    maskedNumber: a.mask ? `****${a.mask}` : '••••',
    balance: a.balance,
    currency: a.currency,
    lastUpdated: item.updatedAt,
    isEnabled: a.isEnabled,
  };
}

async function fetchPlaidItems(): Promise<PlaidItemDTO[]> {
  const { items } = await api.get<{ items: PlaidItemDTO[] }>('/api/plaid/accounts');
  return items ?? [];
}

// Types for linked accounts
export interface LinkedBank {
  id: string;
  institutionName: string;
  institutionLogo?: string;
  lastSynced: string;
  connectionStatus: 'active' | 'expired' | 'error';
  accountsCount: number;
  consentExpiresAt: string;
}

export interface LinkedAccount {
  id: string;
  bankId: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment';
  maskedNumber: string; // Last 4 digits only
  balance: number;
  currency: string;
  lastUpdated: string;
  isEnabled: boolean; // User can disable sync for specific accounts
}

export interface BankTransaction {
  id: string;
  accountId: string;
  amount: number;
  description: string;
  category?: string;
  merchantName?: string;
  date: string;
  pending: boolean;
  type: 'debit' | 'credit';
}

export interface ConsentInfo {
  dataAccessed: string[];
  permissions: string[];
  expiresAt: string;
  canRevoke: boolean;
}

// Storage keys. Per user (storage-keys.ts): an offline snapshot of this user's
// Plaid links — bank names and masked account numbers — deleted on sign-out.
const LINKED_BANKS_KEY = 'linked_banks';
const LINKED_ACCOUNTS_KEY = 'linked_accounts';

// The cache is a convenience: a failure here — including nobody being signed
// in, when userKey() throws — must never fail the call it decorates.
function parseCached<T>(data: string | null): T[] {
  try {
    const parsed: unknown = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// There is deliberately no bank list here.
//
// There used to be eight hardcoded US banks with emoji logos, and the id the
// user picked was thrown away: the connect flow opens Plaid's Hosted Link,
// where they choose their bank from the real institution list. So the picker
// asked the same question twice, and for anyone outside the US it offered
// eight banks that were not theirs — see lib/bank-providers for the countries
// actually supported.

// Get all linked banks (live from the backend Plaid integration).
export async function getLinkedBanks(): Promise<LinkedBank[]> {
  try {
    const items = await fetchPlaidItems();
    const banks = items.map(itemToBank);
    // Cache for offline display.
    try {
      await AsyncStorage.setItem(userKey(LINKED_BANKS_KEY), JSON.stringify(banks));
    } catch {
      /* offline display only */
    }
    return banks;
  } catch {
    // Fall back to the last cached snapshot when offline / unconfigured.
    try {
      return parseCached<LinkedBank>(await AsyncStorage.getItem(userKey(LINKED_BANKS_KEY)));
    } catch {
      return [];
    }
  }
}

// Get all linked accounts (live from the backend Plaid integration).
export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  try {
    const items = await fetchPlaidItems();
    const accounts = items.flatMap((item) => item.accounts.map((a) => accountToLinked(item, a)));
    try {
      await AsyncStorage.setItem(userKey(LINKED_ACCOUNTS_KEY), JSON.stringify(accounts));
    } catch {
      /* offline display only */
    }
    return accounts;
  } catch {
    try {
      return parseCached<LinkedAccount>(await AsyncStorage.getItem(userKey(LINKED_ACCOUNTS_KEY)));
    } catch {
      return [];
    }
  }
}

// Get accounts for a specific bank
export async function getAccountsByBank(bankId: string): Promise<LinkedAccount[]> {
  const accounts = await getLinkedAccounts();
  return accounts.filter(acc => acc.bankId === bankId);
}

// Step 1 of the real Plaid flow: ask the backend for a Link token. We use Plaid
// Hosted Link so the bank login opens in a browser (expo-web-browser) without
// bundling the native Plaid Link SDK. Completion is delivered to the backend via
// the SESSION_FINISHED webhook, which exchanges the public_token automatically.
export async function createLinkToken(): Promise<{
  linkToken: string;
  hostedLinkUrl: string | null;
  expiration: string;
}> {
  return api.post('/api/plaid/link-token', {});
}

// Step 2: exchange the public_token from Plaid Link for a stored access token.
// The backend persists the Item + accounts and runs an initial transaction sync.
export async function completeBankConnection(
  publicToken: string
): Promise<{ success: boolean; bank?: LinkedBank; accounts?: LinkedAccount[]; error?: string }> {
  try {
    await api.post('/api/plaid/exchange', { publicToken });
    requestPull();
    // Re-read the canonical state from the backend.
    const items = await fetchPlaidItems();
    const newest = items[items.length - 1];
    return {
      success: true,
      bank: newest ? itemToBank(newest) : undefined,
      accounts: newest ? newest.accounts.map((a) => accountToLinked(newest, a)) : [],
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

// Disconnect a bank — revokes the Plaid Item on the backend and clears the cache.
export async function disconnectBank(bankId: string): Promise<boolean> {
  try {
    await api.delete(`/api/plaid/items/${bankId}`);
    requestPull();
    try {
      await AsyncStorage.removeItem(userKey(LINKED_BANKS_KEY));
      await AsyncStorage.removeItem(userKey(LINKED_ACCOUNTS_KEY));
    } catch {
      /* nothing cached, or nobody signed in */
    }
    return true;
  } catch {
    return false;
  }
}

// Toggle account sync
// Enable/disable syncing for a single linked account. Persists to the backend
// (PlaidAccount.isEnabled); disabled accounts are skipped by the next sync.
// `accountId` is the Plaid account id used as LinkedAccount.id.
export async function toggleAccountSync(accountId: string, enabled: boolean): Promise<boolean> {
  try {
    await api.patch(`/api/plaid/accounts/${accountId}`, { isEnabled: enabled });
    return true;
  } catch {
    return false;
  }
}

// Sync transactions for all linked accounts
export async function syncAllTransactions(): Promise<{
  success: boolean;
  newTransactions: number;
  errors: string[];
}> {
  try {
    // Backend pulls new transactions from Plaid for every active Item using the
    // stored access tokens and upserts them into the user's transactions.
    const { added, errors } = await api.post<{ added: number; errors: string[] }>(
      '/api/plaid/transactions/sync',
      {}
    );
    // Even a partial sync may have booked some: bring them into the ledger.
    requestPull();
    return { success: errors.length === 0, newTransactions: added, errors };
  } catch (e) {
    return {
      success: false,
      newTransactions: 0,
      errors: [e instanceof Error ? e.message : 'Sync failed'],
    };
  }
}

/**
 * What a bank connection grants us.
 *
 * Takes an optional connection: before linking there is no bank yet, and the
 * terms are the same either way.
 */
export function getConsentInfo(bank?: LinkedBank): ConsentInfo {
  return {
    dataAccessed: [
      'Account balances',
      'Transaction history (last 90 days)',
      'Account names and numbers (masked)',
    ],
    permissions: [
      'Read-only access to accounts',
      'No ability to make payments',
      'No access to personal details',
    ],
    expiresAt: bank?.consentExpiresAt ?? '',
    canRevoke: true,
  };
}

// Check if any bank connections need renewal
export async function checkConnectionHealth(): Promise<{
  healthy: LinkedBank[];
  expiringSoon: LinkedBank[];
  expired: LinkedBank[];
}> {
  const banks = await getLinkedBanks();
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const healthy: LinkedBank[] = [];
  const expiringSoon: LinkedBank[] = [];
  const expired: LinkedBank[] = [];

  for (const bank of banks) {
    const expiresAt = new Date(bank.consentExpiresAt);

    if (expiresAt < now) {
      expired.push({ ...bank, connectionStatus: 'expired' });
    } else if (expiresAt < sevenDaysFromNow) {
      expiringSoon.push(bank);
    } else {
      healthy.push(bank);
    }
  }

  return { healthy, expiringSoon, expired };
}

// Sync scheduling settings used to live here — autoSync, syncFrequency,
// notifyOnNewTransactions and friends. Nothing read them and no scheduler
// existed to honour them, so they were settings that silently did nothing.
// Syncing is triggered explicitly, and by the provider's webhook.

