/**
 * Pure CSV/JSON serialisation for the data export.
 *
 * Dependency-free so the export → import round trip can be asserted in a test
 * without expo-file-system or the share sheet. export-data.ts wraps these with
 * the file writing and sharing.
 */

/** The subset of a stored transaction that gets exported. */
export interface ExportableTransaction {
  id: string;
  amount: number;
  category: string;
  type: string;
  isImpulse: number | boolean;
  note?: string | null;
  dateISO: string;
  createdAt?: string;
  accountId?: string | null;
  currency?: string;
}

/** Escape a value for a CSV cell (quote if it contains a comma, quote or newline). */
export function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Every column the importer can read.
 *
 * Anything omitted here is re-derived on import, and derivation is lossy:
 * Category used to be written but ignored on the way back in, so a category the
 * user had corrected by hand was replaced by a keyword guess. Impulse was never
 * written at all, so it could not be recovered by any means.
 */
export const EXPORT_COLUMNS = [
  'Date',
  'Description',
  'Amount',
  'Category',
  'Type',
  'Impulse',
  'Currency',
] as const;

export function buildTransactionsCSV(txs: ExportableTransaction[]): string {
  const header = EXPORT_COLUMNS.join(',');
  const rows = txs.map((tx) => {
    // Expense → negative, so a reader that only understands a signed amount
    // column still gets the direction right. The Type column is authoritative.
    const signed = tx.type === 'Income' ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    return [
      csvCell(tx.dateISO),
      csvCell(tx.note ?? ''),
      signed.toString(),
      csvCell(tx.category),
      csvCell(tx.type),
      tx.isImpulse ? 'true' : 'false',
      csvCell(tx.currency ?? 'USD'),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

/** Full-fidelity JSON backup (every column, no lossy sign encoding). */
export function buildTransactionsJSON(txs: ExportableTransaction[]): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), transactions: txs },
    null,
    2
  );
}
