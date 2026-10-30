/**
 * Data export / backup — the counterpart to import.tsx.
 *
 * Writes a real file to the cache dir and hands it to the native share sheet
 * via expo-sharing (falling back to the RN Share API where unavailable, e.g.
 * web). The CSV is round-trip compatible with parseCSV() in import-parser.ts.
 *
 * Every column the importer can read is written, because anything omitted is
 * re-derived on import and derivation is lossy: Category was previously
 * written but ignored on the way back in, so a category the user had corrected
 * by hand was silently replaced by a keyword guess — and Impulse was never
 * written at all, so it could not be recovered by any means.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Share, Platform } from 'react-native';
import { getTransactions } from './db';
import { buildTransactionsCSV, buildTransactionsJSON } from './csv-export';

export {
  csvCell,
  buildTransactionsCSV,
  buildTransactionsJSON,
  EXPORT_COLUMNS,
  type ExportableTransaction,
} from './csv-export';

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
  await shareFile(csv, `latchet-${stamp}.csv`, 'text/csv', 'Export transactions (CSV)');
  return txs.length;
}

/** Export a full JSON backup of all transactions via the share sheet. */
export async function exportTransactionsJSON(): Promise<number> {
  const txs = await getTransactions();
  const json = buildTransactionsJSON(txs);
  const stamp = new Date().toISOString().slice(0, 10);
  await shareFile(json, `latchet-backup-${stamp}.json`, 'application/json', 'Backup transactions (JSON)');
  return txs.length;
}
