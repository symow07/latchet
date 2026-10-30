/**
 * Adapters turning each data source into the engine's charge stream.
 *
 * All the source-specific knowledge lives here — which field carries the
 * merchant, how dates are shaped, what counts as an outflow — so the engine
 * itself never has to know where a charge came from.
 */
import type { ChargeSource, SourceCharge } from './types';

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

/**
 * Device transactions as charges. `sourceOf` says where each one came from (a
 * statement import, a bank feed, a hand-typed entry) so the engine can fold
 * the copies of one payment together; without it every row is a 'transaction'.
 * `ledgerCurrency` is the account's currency (see rowCurrency).
 */
export function chargesFromTransactions(
  txs: TransactionLike[],
  sourceOf: (tx: TransactionLike) => ChargeSource = () => 'transaction',
  ledgerCurrency?: string | null
): SourceCharge[] {
  const charges: SourceCharge[] = [];
  for (const tx of txs) {
    if (tx.type !== 'Expense') continue;
    const merchant = merchantTextOf(tx.note);
    if (!merchant) continue;

    const source = sourceOf(tx);
    charges.push({
      id: tx.id,
      merchant,
      amount: Math.abs(tx.amount),
      dateISO: tx.dateISO.slice(0, 10),
      currency: rowCurrency(tx.currency, source, ledgerCurrency),
      source,
      category: tx.category,
    });
  }
  return charges;
}

/**
 * The currency a ledger row was paid in.
 *
 * db.ts writes 'USD' on any row saved without a currency: a receipt scan, the
 * share sheet, quick-add, a statement with no currency column. On a row the
 * app wrote, then, 'USD' says nothing, and the row is in the account's
 * currency, as History shows it; reading it as dollars made Subscriptions
 * show "$" on a yuan account. A code the row names otherwise stands (an
 * Alipay bill is in yuan whatever the account's currency), and a bank feed's
 * rows carry the bank's own.
 */
function rowCurrency(stated: string | null | undefined, source: ChargeSource, ledgerCurrency: string | null | undefined): string {
  const mine = (ledgerCurrency ?? '').trim().toUpperCase();
  if (source === 'bank' || !mine) return stated || 'USD';
  const code = (stated ?? '').trim().toUpperCase();
  return !code || code === 'USD' ? mine : code;
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
