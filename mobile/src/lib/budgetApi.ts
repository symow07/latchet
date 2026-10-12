import { authedFetch } from './api/api';
import { readJson, request } from './api-errors';

const getBackendUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!url) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  return url;
};

export type BudgetCategory = 'Travel' | 'Software' | 'Meals' | 'Transport' | 'Office' | 'Other';

export interface BudgetData {
  budget: {
    totalMonthly: number;
    categories: Partial<Record<BudgetCategory, number>>;
  };
  spending: {
    total: number;
    approved: number;
    byCategory: Partial<Record<BudgetCategory, { spent: number; approved: number }>>;
  };
  month: {
    year: number;
    month: number;
    label: string;
  };
}

// Every call rejects with an ApiFailure (lib/api-errors), whose message is
// already in the reader's language — the screens show it as it is.

export async function getBudget(): Promise<BudgetData> {
  return request(async () =>
    readJson<BudgetData>(await authedFetch(`${getBackendUrl()}/api/business/budget`)),
  );
}

export async function setBudget(payload: {
  totalMonthly: number;
  categories: Partial<Record<BudgetCategory, number>>;
}): Promise<{ budget: { totalMonthly: number; categories: Partial<Record<BudgetCategory, number>> } }> {
  return request(async () =>
    readJson(
      await authedFetch(`${getBackendUrl()}/api/business/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ),
  );
}
