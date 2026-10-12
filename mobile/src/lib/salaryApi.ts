import { authedFetch } from './api/api';
import { ensureOk, readJson, request } from './api-errors';
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
//
// Every call rejects with an ApiFailure (lib/api-errors): its message is
// already a sentence in the reader's language, which is what the screens show.

type Init = Parameters<typeof authedFetch>[1];

/** A request carrying `payload` as JSON. */
const withJson = (method: string, payload: unknown): Init => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** One call whose answer is JSON. */
function call<T>(path: string, init?: Init): Promise<T> {
  return request(async () => readJson<T>(await authedFetch(`${getBackendUrl()}${path}`, init)));
}

export async function getPayroll(month?: number, year?: number): Promise<PayrollData> {
  const params = new URLSearchParams();
  if (month) params.set('month', String(month));
  if (year)  params.set('year',  String(year));
  return call<PayrollData>(`/api/payroll?${params}`);
}

export async function setSalary(payload: {
  userId: string;
  amount: number;
  title?: string | null;
  currency?: string;
}): Promise<SalaryRecord> {
  const data = await call<{ salary: SalaryRecord }>('/api/payroll', withJson('POST', payload));
  return data.salary;
}

export async function deleteSalary(id: string): Promise<void> {
  await request(async () =>
    ensureOk(await authedFetch(`${getBackendUrl()}/api/payroll/${id}`, { method: 'DELETE' })),
  );
}

export async function markPaid(
  id: string,
  month: number,
  year: number,
  note?: string
): Promise<SalaryPaymentRecord> {
  const data = await call<{ payment: SalaryPaymentRecord }>(
    `/api/payroll/${id}/pay`,
    withJson('PATCH', { month, year, note: note ?? null }),
  );
  return data.payment;
}

export async function markUnpaid(
  id: string,
  month: number,
  year: number
): Promise<SalaryPaymentRecord> {
  const data = await call<{ payment: SalaryPaymentRecord }>(
    `/api/payroll/${id}/unpay`,
    withJson('PATCH', { month, year }),
  );
  return data.payment;
}
