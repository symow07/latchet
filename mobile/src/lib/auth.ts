import AsyncStorage from '@react-native-async-storage/async-storage';

const USER_KEY = '@real_budget_user';
const ONBOARDING_KEY = '@real_budget_onboarding';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface OnboardingData {
  monthlyIncome: number;
  savingsGoal: number;
  spendingStyle: 'frugal' | 'moderate' | 'generous';
  primaryGoal: 'save' | 'track' | 'reduce_debt' | 'budget';
  currency: string;
  currencySymbol: string;
  completed: boolean;
}

// Simple hash function for password (demo purposes - use proper hashing in production)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export async function signUp(email: string, password: string, name: string): Promise<User> {
  const existingUsers = await getStoredUsers();

  if (existingUsers.find(u => u.email === email)) {
    throw new Error('Email already exists');
  }

  const user: User = {
    id: `user_${Date.now()}`,
    email,
    name,
    createdAt: new Date().toISOString(),
  };

  // Store user with hashed password
  existingUsers.push({ ...user, passwordHash: simpleHash(password) });
  await AsyncStorage.setItem('@real_budget_users', JSON.stringify(existingUsers));

  // Set current user
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));

  return user;
}

export async function login(email: string, password: string): Promise<User> {
  const existingUsers = await getStoredUsers();
  const userRecord = existingUsers.find(
    u => u.email === email && u.passwordHash === simpleHash(password)
  );

  if (!userRecord) {
    throw new Error('Invalid email or password');
  }

  const user: User = {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    createdAt: userRecord.createdAt,
  };

  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function logout(): Promise<void> {
  await AsyncStorage.removeItem(USER_KEY);
}

export async function getCurrentUser(): Promise<User | null> {
  const userStr = await AsyncStorage.getItem(USER_KEY);
  if (!userStr) return null;
  return JSON.parse(userStr);
}

export async function getStoredUsers(): Promise<(User & { passwordHash: string })[]> {
  const usersStr = await AsyncStorage.getItem('@real_budget_users');
  if (!usersStr) return [];
  return JSON.parse(usersStr);
}

// Onboarding
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
