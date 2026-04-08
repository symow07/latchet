const getBackendUrl = () =>
  process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'http://localhost:3000';

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

export async function getBudget(): Promise<BudgetData> {
  const res = await fetch(`${getBackendUrl()}/api/business/budget`, {
    credentials: 'include',
  });
  const data = await res.json() as BudgetData & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch budget');
  return data;
}

export async function setBudget(payload: {
  totalMonthly: number;
  categories: Partial<Record<BudgetCategory, number>>;
}): Promise<{ budget: { totalMonthly: number; categories: Partial<Record<BudgetCategory, number>> } }> {
  const res = await fetch(`${getBackendUrl()}/api/business/budget`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as { budget: { totalMonthly: number; categories: Partial<Record<BudgetCategory, number>> }; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to save budget');
  return data;
}
