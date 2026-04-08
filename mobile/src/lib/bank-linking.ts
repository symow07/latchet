/**
 * Bank Linking Infrastructure
 * Handles secure bank connections via Open Banking APIs
 * Uses OAuth-based authentication with no password storage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Get all linked banks
export async function getLinkedBanks(): Promise<LinkedBank[]> {
  try {
    const data = await AsyncStorage.getItem(LINKED_BANKS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Get all linked accounts
export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  try {
    const data = await AsyncStorage.getItem(LINKED_ACCOUNTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Get accounts for a specific bank
export async function getAccountsByBank(bankId: string): Promise<LinkedAccount[]> {
  const accounts = await getLinkedAccounts();
  return accounts.filter(acc => acc.bankId === bankId);
}

// Simulate OAuth bank connection flow
export async function initiateBankConnection(
  bankId: string,
  _onAuthUrl: (url: string) => void
): Promise<{ success: boolean; authUrl?: string; error?: string }> {
  // In production, this would:
  // 1. Call your backend to initiate OAuth flow with the bank's Open Banking API
  // 2. Return the authorization URL for the user to authenticate
  // 3. Handle the callback with auth code
  // 4. Exchange auth code for access token (stored securely on backend)

  const bank = SUPPORTED_BANKS.find(b => b.id === bankId);
  if (!bank) {
    return { success: false, error: 'Bank not supported' };
  }

  // Simulated OAuth URL (in real app, this comes from your backend)
  const authUrl = `https://auth.${bankId}.example.com/oauth/authorize?client_id=realbudget&scope=accounts:read,transactions:read&redirect_uri=realbudget://callback`;

  return { success: true, authUrl };
}

// Complete bank connection (called after OAuth callback)
export async function completeBankConnection(
  bankId: string,
  _authCode: string
): Promise<{ success: boolean; bank?: LinkedBank; accounts?: LinkedAccount[]; error?: string }> {
  const bank = SUPPORTED_BANKS.find(b => b.id === bankId);
  if (!bank) {
    return { success: false, error: 'Bank not found' };
  }

  // Simulate successful connection
  // In production, your backend would:
  // 1. Exchange auth code for access token
  // 2. Store encrypted tokens securely
  // 3. Fetch account list from bank
  // 4. Return account info to client

  const newBank: LinkedBank = {
    id: `bank_${Date.now()}`,
    institutionName: bank.name,
    institutionLogo: bank.logo,
    lastSynced: new Date().toISOString(),
    connectionStatus: 'active',
    accountsCount: 2, // Simulated
    consentExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
  };

  // Simulated accounts
  const newAccounts: LinkedAccount[] = [
    {
      id: `acc_${Date.now()}_1`,
      bankId: newBank.id,
      name: `${bank.name} Checking`,
      type: 'checking',
      maskedNumber: '****4521',
      balance: 3245.67,
      currency: 'USD',
      lastUpdated: new Date().toISOString(),
      isEnabled: true,
    },
    {
      id: `acc_${Date.now()}_2`,
      bankId: newBank.id,
      name: `${bank.name} Savings`,
      type: 'savings',
      maskedNumber: '****8890',
      balance: 12500.00,
      currency: 'USD',
      lastUpdated: new Date().toISOString(),
      isEnabled: true,
    },
  ];

  // Save to storage
  const existingBanks = await getLinkedBanks();
  await AsyncStorage.setItem(LINKED_BANKS_KEY, JSON.stringify([...existingBanks, newBank]));

  const existingAccounts = await getLinkedAccounts();
  await AsyncStorage.setItem(LINKED_ACCOUNTS_KEY, JSON.stringify([...existingAccounts, ...newAccounts]));

  return { success: true, bank: newBank, accounts: newAccounts };
}

// Disconnect a bank (revoke consent)
export async function disconnectBank(bankId: string): Promise<boolean> {
  try {
    // In production, would also call backend to revoke tokens with the bank

    const banks = await getLinkedBanks();
    const filteredBanks = banks.filter(b => b.id !== bankId);
    await AsyncStorage.setItem(LINKED_BANKS_KEY, JSON.stringify(filteredBanks));

    const accounts = await getLinkedAccounts();
    const filteredAccounts = accounts.filter(a => a.bankId !== bankId);
    await AsyncStorage.setItem(LINKED_ACCOUNTS_KEY, JSON.stringify(filteredAccounts));

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
  const accounts = await getLinkedAccounts();
  const enabledAccounts = accounts.filter(acc => acc.isEnabled);

  let newTransactions = 0;
  const errors: string[] = [];

  for (const account of enabledAccounts) {
    try {
      // In production, would call backend to fetch new transactions
      // Backend would use stored access tokens to call bank API

      // Simulated: would return actual transaction count
      newTransactions += Math.floor(Math.random() * 5);
    } catch {
      errors.push(`Failed to sync ${account.name}`);
    }
  }

  // Update last synced time for banks
  const banks = await getLinkedBanks();
  const updatedBanks = banks.map(bank => ({
    ...bank,
    lastSynced: new Date().toISOString(),
  }));
  await AsyncStorage.setItem(LINKED_BANKS_KEY, JSON.stringify(updatedBanks));

  return { success: errors.length === 0, newTransactions, errors };
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
