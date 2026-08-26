import { authedFetch } from './api/api';
const getBackendUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!url) throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  return url;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PayrollUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface SalaryPaymentRecord {
  id: string;
  month: number;
  year: number;
  status: 'paid' | 'unpaid';
  paidAt: string | null;
  note: string | null;
}

export interface SalaryRecord {
  id: string;
  businessId: string;
  userId: string;
  amount: number;
  currency: string;
  title: string | null;
  createdAt: string;
  user: PayrollUser;
  payment: SalaryPaymentRecord;
}

export interface PayrollSummary {
  totalPayroll: number;
  paidTotal: number;
  unpaidTotal: number;
  month: number;
  year: number;
}

export interface PayrollData {
  salaries: SalaryRecord[];
  summary: PayrollSummary;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function getPayroll(month?: number, year?: number): Promise<PayrollData> {
  const params = new URLSearchParams();
  if (month) params.set('month', String(month));
  if (year)  params.set('year',  String(year));
  const res = await authedFetch(`${getBackendUrl()}/api/payroll?${params}`);
  const data = await res.json() as PayrollData & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed to fetch payroll');
  return data;
}

export async function setSalary(payload: {
  userId: string;
  amount: number;
  title?: string | null;
  currency?: string;
}): Promise<SalaryRecord> {
  const res = await authedFetch(`${getBackendUrl()}/api/payroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as { salary: SalaryRecord; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to save salary');
  return data.salary;
}

export async function deleteSalary(id: string): Promise<void> {
  const res = await authedFetch(`${getBackendUrl()}/api/payroll/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? 'Failed to delete salary');
  }
}

export async function markPaid(
  id: string,
  month: number,
  year: number,
  note?: string
): Promise<SalaryPaymentRecord> {
  const res = await authedFetch(`${getBackendUrl()}/api/payroll/${id}/pay`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month, year, note: note ?? null }),
  });
  const data = await res.json() as { payment: SalaryPaymentRecord; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to mark as paid');
  return data.payment;
}

export async function markUnpaid(
  id: string,
  month: number,
  year: number
): Promise<SalaryPaymentRecord> {
  const res = await authedFetch(`${getBackendUrl()}/api/payroll/${id}/unpay`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month, year }),
  });
  const data = await res.json() as { payment: SalaryPaymentRecord; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to mark as unpaid');
  return data.payment;
}
