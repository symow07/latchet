/**
 * Choosing a category for a transaction the user never categorised.
 *
 * Siri captures and notification quick-adds both arrive as an amount and a
 * scrap of text — asking for a category would turn a two-second capture into a
 * menu, which is the thing both features exist to avoid. So the note is run
 * through the same ladder the CSV importer uses, and the user can correct it
 * later in the app where correcting is cheap.
 */
import { buildMerchantMemory, suggestCategory, type MerchantMemory } from './merchant-memory';
import { autoCategorize } from './import-parser';
import { getTransactions } from './db';

/**
 * Build the merchant memory from the user's own history.
 *
 * Returns null rather than throwing: no history to learn from is not a reason
 * to drop a capture.
 */
export async function loadMerchantMemory(): Promise<MerchantMemory | null> {
  try {
    return buildMerchantMemory(await getTransactions());
  } catch {
    return null;
  }
}

/**
 * What this user has done before with this merchant, then keywords, then the
 * catch-all. Precedence matters: someone who files every Starbucks under
 * "Other" should keep getting "Other", not the keyword table's "Food".
 */
export function categoriseNote(note: string, memory: MerchantMemory | null): string {
  if (!note) return 'Other';
  return (
    (memory ? suggestCategory(note, memory) : null) || autoCategorize(note) || 'Other'
  );
}
