/**
 * Choosing a category for a transaction the user never categorised.
 *
 * Siri captures, notification quick-adds and shared payment confirmations all
 * arrive as an amount and a scrap of text — asking for a category would turn a
 * two-second capture into a menu, which is the thing these features exist to
 * avoid. So the note is run through the same ladder the CSV importer uses, and
 * the user can correct it later in the app where correcting is cheap.
 *
 * The database is imported lazily, inside the functions that read it, so the
 * ladder itself can be tested without one.
 */
import { buildMerchantMemory, suggestCategory, type MerchantMemory } from './merchant-memory';
import { autoCategorize } from './import-parser';

/**
 * Build the merchant memory from the user's own history.
 *
 * Returns null rather than throwing: no history to learn from is not a reason
 * to drop a capture.
 */
export async function loadMerchantMemory(): Promise<MerchantMemory | null> {
  try {
    const { getTransactions } = await import('./db');
    return buildMerchantMemory(await getTransactions());
  } catch {
    return null;
  }
}

/**
 * The user's currency, which decides which regional brands the keyword
 * fallback knows — Marjane for dirhams, Tesco for pounds, 美团 for yuan.
 * Null rather than throwing: without it the plain words and global brands
 * still apply.
 */
export async function loadUserCurrency(): Promise<string | null> {
  try {
    const { getSettings } = await import('./db');
    return (await getSettings())?.currency || null;
  } catch {
    return null;
  }
}

/** Everything categoriseNote needs from the user's data, loaded once per batch. */
export interface NoteContext {
  memory: MerchantMemory | null;
  currency: string | null;
}

export async function loadNoteContext(): Promise<NoteContext> {
  const [memory, currency] = await Promise.all([loadMerchantMemory(), loadUserCurrency()]);
  return { memory, currency };
}

/**
 * What this user has done before with this merchant, then keywords, then the
 * catch-all. Precedence matters: someone who files every Starbucks under
 * "Other" should keep getting "Other", not the keyword table's "Food".
 *
 * `currency` is the user's: it picks the keyword fallback's regional brands.
 */
export function categoriseNote(
  note: string,
  memory: MerchantMemory | null,
  currency?: string | null,
): string {
  if (!note) return 'Other';
  return (memory ? suggestCategory(note, memory) : null) || autoCategorize(note, currency);
}
