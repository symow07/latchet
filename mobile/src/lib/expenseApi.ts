import { authedFetch } from './api/api';
import { readJson, request } from './api-errors';
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
//
// Every call rejects with an ApiFailure (lib/api-errors): its message is
// already a sentence in the reader's language, which is what the screens show.

type Init = Parameters<typeof authedFetch>[1];

/** One call whose answer is JSON. */
function call<T>(path: string, init?: Init): Promise<T> {
  return request(async () => readJson<T>(await authedFetch(`${getBackendUrl()}${path}`, init)));
}

export async function submitExpense(data: {
  amount: number;
  category: ExpenseCategory;
  description: string;
  /** The receipt itself, base64. The server stores it and fills in imageUrl. */
  image?: string | null;
}): Promise<Expense> {
  const json = await call<{ expense: Expense }>('/api/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return json.expense;
}

export async function getExpenses(status?: ExpenseStatus): Promise<Expense[]> {
  const json = await call<{ expenses: Expense[] }>(status ? `/api/expenses?status=${status}` : '/api/expenses');
  return json.expenses;
}

export async function approveExpense(id: string): Promise<Expense> {
  const json = await call<{ expense: Expense }>(`/api/expenses/${id}/approve`, { method: 'PATCH' });
  return json.expense;
}

export async function rejectExpense(id: string): Promise<Expense> {
  const json = await call<{ expense: Expense }>(`/api/expenses/${id}/reject`, { method: 'PATCH' });
  return json.expense;
}
