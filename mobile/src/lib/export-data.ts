/**
 * Data export / backup — the counterpart to import.tsx.
 *
 * Writes a real file to the cache dir and hands it to the native share sheet
 * via expo-sharing (falling back to the RN Share API where unavailable, e.g.
 * web). The CSV is intentionally round-trip compatible with parseCSV() in
 * import-parser.ts: a `Date,Description,Amount,Category,Type` header with a
 * single signed Amount column (expenses negative) so a re-import reconstructs
 * the same transactions.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share, Platform } from 'react-native';
import { getTransactions } from './db';

/** Escape a value for a CSV cell (quote if it contains a comma, quote or newline). */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build a round-trippable CSV string from all stored transactions. */
export function buildTransactionsCSV(
  txs: Awaited<ReturnType<typeof getTransactions>>
): string {
  const header = ['Date', 'Description', 'Amount', 'Category', 'Type'].join(',');
  const rows = txs.map((tx) => {
    // Expense → negative so parseCSV() infers the type back on import.
    const signed = tx.type === 'Income' ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    return [
      csvCell(tx.dateISO),
      csvCell(tx.note ?? ''),
      signed.toString(),
      csvCell(tx.category),
      csvCell(tx.type),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

/** Full-fidelity JSON backup (every column, no lossy sign encoding). */
export function buildTransactionsJSON(
  txs: Awaited<ReturnType<typeof getTransactions>>
): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), transactions: txs }, null, 2);
}

async function shareFile(content: string, filename: string, mimeType: string, dialogTitle: string) {
  // Web has no file system / Sharing module — fall back to the text share API.
  if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync().catch(() => false))) {
    await Share.share({ message: content, title: dialogTitle });
    return;
  }
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI: 'public.comma-separated-values-text' });
}

/** Export all transactions as a CSV file via the share sheet. */
export async function exportTransactionsCSV(): Promise<number> {
  const txs = await getTransactions();
  const csv = buildTransactionsCSV(txs);
  const stamp = new Date().toISOString().slice(0, 10);
  await shareFile(csv, `real-budget-${stamp}.csv`, 'text/csv', 'Export transactions (CSV)');
  return txs.length;
}

/** Export a full JSON backup of all transactions via the share sheet. */
export async function exportTransactionsJSON(): Promise<number> {
  const txs = await getTransactions();
  const json = buildTransactionsJSON(txs);
  const stamp = new Date().toISOString().slice(0, 10);
  await shareFile(json, `real-budget-backup-${stamp}.json`, 'application/json', 'Backup transactions (JSON)');
  return txs.length;
}
