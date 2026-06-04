/**
 * Bank Linking Infrastructure
 * Handles secure bank connections via Open Banking APIs
 * Uses OAuth-based authentication with no password storage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api/api';

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
  updatedAt: string;
  accounts: PlaidAccountDTO[];
}

function mapAccountType(t: string): LinkedAccount['type'] {
  if (t === 'credit' || t === 'investment' || t === 'savings') return t;
  if (t === 'checking') return 'checking';
  return 'checking';
}

function itemToBank(item: PlaidItemDTO): LinkedBank {
  return {
    id: item.id,
    institutionName: item.institutionName ?? 'Bank',
    lastSynced: item.updatedAt,
    connectionStatus: item.status === 'active' ? 'active' : 'error',
    accountsCount: item.accounts.length,
    // Plaid consent typically lasts ~90 days; surface a derived expiry for display.
    consentExpiresAt: new Date(
      new Date(item.updatedAt).getTime() + 90 * 24 * 60 * 60 * 1000
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

// Storage keys
const LINKED_BANKS_KEY = 'linked_banks';
const LINKED_ACCOUNTS_KEY = 'linked_accounts';
const SYNC_SETTINGS_KEY = 'bank_sync_settings';

// Mock supported banks (in real app, would come from Open Banking API)
export const SUPPORTED_BANKS = [
  { id: 'chase', name: 'Chase', logo: '🏦', color: '#117ACA' },
  { id: 'bofa', name: 'Bank of America', logo: '🏛️', color: '#012169' },
  { id: 'wells', name: 'Wells Fargo', logo: '🏪', color: '#D71E28' },
  { id: 'citi', name: 'Citibank', logo: '💳', color: '#003B70' },
  { id: 'capital_one', name: 'Capital One', logo: '💰', color: '#D03027' },
  { id: 'usbank', name: 'US Bank', logo: '🏢', color: '#0C2074' },
  { id: 'pnc', name: 'PNC Bank', logo: '🏗️', color: '#FF6600' },
  { id: 'td', name: 'TD Bank', logo: '🌿', color: '#34A853' },
];

// Get all linked banks (live from the backend Plaid integration).
export async function getLinkedBanks(): Promise<LinkedBank[]> {
  try {
    const items = await fetchPlaidItems();
    const banks = items.map(itemToBank);
    // Cache for offline display.
    await AsyncStorage.setItem(LINKED_BANKS_KEY, JSON.stringify(banks)).catch(() => {});
    return banks;
  } catch {
    // Fall back to the last cached snapshot when offline / unconfigured.
    const data = await AsyncStorage.getItem(LINKED_BANKS_KEY).catch(() => null);
    return data ? JSON.parse(data) : [];
  }
}

// Get all linked accounts (live from the backend Plaid integration).
export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  try {
    const items = await fetchPlaidItems();
    const accounts = items.flatMap((item) => item.accounts.map((a) => accountToLinked(item, a)));
    await AsyncStorage.setItem(LINKED_ACCOUNTS_KEY, JSON.stringify(accounts)).catch(() => {});
    return accounts;
  } catch {
    const data = await AsyncStorage.getItem(LINKED_ACCOUNTS_KEY).catch(() => null);
    return data ? JSON.parse(data) : [];
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
    await AsyncStorage.removeItem(LINKED_BANKS_KEY).catch(() => {});
    await AsyncStorage.removeItem(LINKED_ACCOUNTS_KEY).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// Toggle account sync
export async function toggleAccountSync(accountId: string, enabled: boolean): Promise<boolean> {
  try {
    const accounts = await getLinkedAccounts();
    const updatedAccounts = accounts.map(acc =>
      acc.id === accountId ? { ...acc, isEnabled: enabled } : acc
    );
    await AsyncStorage.setItem(LINKED_ACCOUNTS_KEY, JSON.stringify(updatedAccounts));
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
    return { success: errors.length === 0, newTransactions: added, errors };
  } catch (e) {
    return {
      success: false,
      newTransactions: 0,
      errors: [e instanceof Error ? e.message : 'Sync failed'],
    };
  }
}

// Get consent information for a bank
export function getConsentInfo(bank: LinkedBank): ConsentInfo {
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
    expiresAt: bank.consentExpiresAt,
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

// Get sync settings
export interface SyncSettings {
  autoSync: boolean;
  syncFrequency: 'daily' | 'weekly' | 'manual';
  lastAutoSync: string | null;
  notifyOnNewTransactions: boolean;
  notifyOnLargeTransactions: boolean;
  largeTransactionThreshold: number;
}

export async function getSyncSettings(): Promise<SyncSettings> {
  try {
    const data = await AsyncStorage.getItem(SYNC_SETTINGS_KEY);
    return data ? JSON.parse(data) : {
      autoSync: true,
      syncFrequency: 'daily',
      lastAutoSync: null,
      notifyOnNewTransactions: true,
      notifyOnLargeTransactions: true,
      largeTransactionThreshold: 100,
    };
  } catch {
    return {
      autoSync: true,
      syncFrequency: 'daily',
      lastAutoSync: null,
      notifyOnNewTransactions: true,
      notifyOnLargeTransactions: true,
      largeTransactionThreshold: 100,
    };
  }
}

export async function updateSyncSettings(settings: Partial<SyncSettings>): Promise<boolean> {
  try {
    const current = await getSyncSettings();
    await AsyncStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
    return true;
  } catch {
    return false;
  }
}
