/**
 * Adapters turning each data source into the engine's charge stream.
 *
 * All the source-specific knowledge lives here — which field carries the
 * merchant, how dates are shaped, what counts as an outflow — so the engine
 * itself never has to know where a charge came from.
 */
import type { SourceCharge } from './types';

/** A device transaction, as stored in SQLite. */
export interface TransactionLike {
  id: string;
  amount: number;
  category: string;
  type: string;
  note?: string | null;
  dateISO: string;
  currency?: string | null;
}

/** A business expense, as returned by the expenses API. */
export interface ExpenseLike {
  id: string;
  amount: number;
  category: string;
  description: string;
  submittedAt?: string;
  createdAt?: string;
  currency?: string | null;
}

/**
 * Merchant text worth grouping on.
 *
 * Returns null rather than falling back to the category. Falling back is what
 * made every uncategorised "Food" expense collapse into a single merchant, so
 * the app confidently reported "Food — monthly, $45" as a subscription the user
 * could cancel.
 */
export function merchantTextOf(note: string | null | undefined): string | null {
  const text = (note ?? '').trim();
  if (!text) return null;
  // A pure number or a date is not a merchant name.
  if (/^[\d\s.,\-/]+$/.test(text)) return null;
  return text;
}

export function chargesFromTransactions(txs: TransactionLike[]): SourceCharge[] {
  const charges: SourceCharge[] = [];
  for (const tx of txs) {
    if (tx.type !== 'Expense') continue;
    const merchant = merchantTextOf(tx.note);
    if (!merchant) continue;

    charges.push({
      id: tx.id,
      merchant,
      amount: tx.amount,
      dateISO: tx.dateISO,
      currency: tx.currency || 'USD',
      source: 'transaction',
      category: tx.category,
    });
  }
  return charges;
}

export function chargesFromExpenses(expenses: ExpenseLike[]): SourceCharge[] {
  const charges: SourceCharge[] = [];
  for (const e of expenses) {
    const merchant = merchantTextOf(e.description);
    if (!merchant) continue;

    const when = (e.submittedAt ?? e.createdAt ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) continue;

    charges.push({
      id: e.id,
      merchant,
      amount: e.amount,
      dateISO: when,
      currency: e.currency || 'USD',
      source: 'expense',
      category: e.category,
    });
  }
  return charges;
}
