import AsyncStorage from '@react-native-async-storage/async-storage';
import { userKey } from './storage-keys';

// The onboarding answers are the signed-in user's, so the key is per user
// (storage-keys.ts) and goes with them on sign-out.
const ONBOARDING_KEY = '@real_budget_onboarding';

export interface OnboardingData {
  monthlyIncome: number;
  savingsGoal: number;
  spendingStyle: 'frugal' | 'moderate' | 'generous';
  primaryGoal: 'save' | 'track' | 'reduce_debt' | 'budget';
  currency: string;
  currencySymbol: string;
  completed: boolean;
}

/**
 * What is stored: the answers when this device ran onboarding, or only the
 * flag when a returning account skipped it (returning-account.ts) — its
 * answers are already in its synced settings.
 */
export type StoredOnboarding = Partial<OnboardingData> & { completed: boolean };

export async function saveOnboardingData(data: OnboardingData): Promise<void> {
  await AsyncStorage.setItem(userKey(ONBOARDING_KEY), JSON.stringify(data));
}

export async function getOnboardingData(): Promise<StoredOnboarding | null> {
  const dataStr = await AsyncStorage.getItem(userKey(ONBOARDING_KEY));
  if (!dataStr) return null;
  try {
    return JSON.parse(dataStr) as StoredOnboarding;
  } catch {
    return null;
  }
}

export async function isOnboardingComplete(): Promise<boolean> {
  const data = await getOnboardingData();
  return data?.completed ?? false;
}

/** Record onboarding as done without answers: the account already has its settings. */
export async function markOnboardingComplete(): Promise<void> {
  const existing = await getOnboardingData();
  const next: StoredOnboarding = { ...(existing ?? {}), completed: true };
  await AsyncStorage.setItem(userKey(ONBOARDING_KEY), JSON.stringify(next));
}
