import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AccountType = 'personal' | 'business';

const KEY = (userId: string) => `@account_type_${userId}`;

export interface AccountTypeStore {
  accountType: AccountType | null;
  loaded: boolean;
  load: (userId: string) => Promise<void>;
  save: (userId: string, type: AccountType) => Promise<void>;
  reset: () => void;
}

export const useAccountTypeStore = create<AccountTypeStore>((set) => ({
  accountType: null,
  loaded: false,

  load: async (userId: string) => {
    const val = await AsyncStorage.getItem(KEY(userId));
    set({ accountType: (val as AccountType | null) ?? null, loaded: true });
  },

  save: async (userId: string, type: AccountType) => {
    await AsyncStorage.setItem(KEY(userId), type);
    set({ accountType: type });
  },

  reset: () => set({ accountType: null, loaded: false }),
}));
