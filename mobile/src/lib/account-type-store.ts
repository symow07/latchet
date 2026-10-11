import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userKeyFor } from './storage-keys';

export type AccountType = 'personal' | 'business';

/**
 * Per user (storage-keys.ts): deleted on sign-out. A returning account gets
 * it back from the server after its first pull (returning-account.ts) rather
 * than choosing again.
 */
const ACCOUNT_TYPE_KEY = '@account_type';

function parseAccountType(value: string | null): AccountType | null {
  return value === 'personal' || value === 'business' ? value : null;
}

/** The profile recorded on this device for a user, read straight from storage. */
export async function readStoredAccountType(userId: string): Promise<AccountType | null> {
  return parseAccountType(await AsyncStorage.getItem(userKeyFor(userId, ACCOUNT_TYPE_KEY)));
}

export interface AccountTypeStore {
  accountType: AccountType | null;
  loaded: boolean;
  load: (userId: string) => Promise<void>;
  save: (userId: string, type: AccountType) => Promise<void>;
  reset: () => void;
}

/**
 * Bumped by every save and reset. A load that started before one of them
 * read storage too early: applying its value would undo the save (the root
 * layout loads while activation may be recording a returning account's
 * profile) or resurrect a reset user's choice.
 */
let generation = 0;

export const useAccountTypeStore = create<AccountTypeStore>((set) => ({
  accountType: null,
  loaded: false,

  load: async (userId: string) => {
    const started = generation;
    const value = await readStoredAccountType(userId);
    // Overtaken: a save already set the value (and `loaded`), or a reset
    // means this user is gone and the next one's load decides.
    if (started !== generation) return;
    set({ accountType: value, loaded: true });
  },

  save: async (userId: string, type: AccountType) => {
    generation += 1;
    await AsyncStorage.setItem(userKeyFor(userId, ACCOUNT_TYPE_KEY), type);
    set({ accountType: type, loaded: true });
  },

  reset: () => {
    generation += 1;
    set({ accountType: null, loaded: false });
  },
}));
