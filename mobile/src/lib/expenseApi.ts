const getBackendUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!url) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  return url;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExpenseStatus = 'pending' | 'approved' | 'rejected';
export type ExpenseCategory = 'Travel' | 'Software' | 'Meals' | 'Transport' | 'Office' | 'Other';

export interface ExpenseUser {
  id: string;
  name: string;
  email: string;
}

export interface Expense {
  id: string;
  businessId: string;
  submitterId: string;
  reviewerId: string | null;
  amount: number;
  category: ExpenseCategory;
  description: string;
  imageUrl: string | null;
  status: ExpenseStatus;
  submittedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submitter: ExpenseUser;
  reviewer: ExpenseUser | null;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function submitExpense(data: {
  amount: number;
  category: ExpenseCategory;
  description: string;
  imageUrl?: string | null;
}): Promise<Expense> {
  const res = await fetch(`${getBackendUrl()}/api/expenses`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json() as { expense: Expense; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Failed to submit expense');
  return json.expense;
}

export async function getExpenses(status?: ExpenseStatus): Promise<Expense[]> {
  const url = status
    ? `${getBackendUrl()}/api/expenses?status=${status}`
    : `${getBackendUrl()}/api/expenses`;
  const res = await fetch(url, { credentials: 'include' });
  const json = await res.json() as { expenses: Expense[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Failed to fetch expenses');
  return json.expenses;
}

export async function approveExpense(id: string): Promise<Expense> {
  const res = await fetch(`${getBackendUrl()}/api/expenses/${id}/approve`, {
    method: 'PATCH',
    credentials: 'include',
  });
  const json = await res.json() as { expense: Expense; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Failed to approve expense');
  return json.expense;
}

export async function rejectExpense(id: string): Promise<Expense> {
  const res = await fetch(`${getBackendUrl()}/api/expenses/${id}/reject`, {
    method: 'PATCH',
    credentials: 'include',
  });
  const json = await res.json() as { expense: Expense; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Failed to reject expense');
  return json.expense;
}
