import AsyncStorage from '@react-native-async-storage/async-storage';

// Same key as the legacy auth.ts module so existing user data is preserved
// across the rename.
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

export async function saveOnboardingData(data: OnboardingData): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, JSON.stringify(data));
}

export async function getOnboardingData(): Promise<OnboardingData | null> {
  const dataStr = await AsyncStorage.getItem(ONBOARDING_KEY);
  if (!dataStr) return null;
  return JSON.parse(dataStr);
}

export async function isOnboardingComplete(): Promise<boolean> {
  const data = await getOnboardingData();
  return data?.completed ?? false;
}
