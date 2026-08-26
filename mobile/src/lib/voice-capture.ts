/**
 * Speaking a day's spending into transactions.
 *
 * The recording needs expo-av and the upload needs the API client, so both
 * live in voice-api.ts. This module is the part worth testing without a
 * microphone or a network: what gets written if the user confirms, and what
 * does not.
 *
 * The server never writes. It returns rows and the transcript, and the user
 * reviews them first — speech is the least reliable input the app has, and a
 * misheard amount entered silently is worse than one the user corrects.
 */

/** A row the model heard, before the user has agreed to it. */
export interface VoiceRow {
  dateISO: string;
  amount: number;
  type: 'Expense' | 'Income';
  category: string;
  note: string;
}

export interface VoiceResult {
  /** What Whisper heard, shown so the user can see why a row looks wrong. */
  transcript: string;
  rows: VoiceRow[];
}

/**
 * The shape db.addTransaction accepts.
 *
 * Restated rather than imported: lib/db pulls in expo-sqlite, and importing it
 * even for a type would stop this module being testable without a simulator.
 * A mismatch is caught at the call site, which does import the real type.
 */
export interface VoiceTransactionInput {
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse: boolean;
  note?: string;
  dateISO: string;
}

/** A row in the review sheet: the heard values plus whether to keep it. */
export interface ReviewRow extends VoiceRow {
  /** Stable across edits, so the list does not re-order under the user. */
  key: string;
  include: boolean;
}

/** Turn extracted rows into review rows, all included by default. */
export function toReviewRows(rows: readonly VoiceRow[]): ReviewRow[] {
  return rows.map((r, i) => ({ ...r, key: `voice_${i}_${r.amount}_${r.dateISO}`, include: true }));
}

/**
 * The transactions to write for the rows the user kept.
 *
 * isImpulse is false rather than inferred. detectImpulse guesses from keywords
 * in a typed description, and a spoken sentence is not that — guessing here
 * would quietly mark ordinary spending as impulsive and skew the one metric
 * the dashboard reports about self-control.
 */
export function toTransactionInputs(rows: readonly ReviewRow[]): VoiceTransactionInput[] {
  return rows
    .filter((r) => r.include && r.amount > 0)
    .map((r) => ({
      amount: r.amount,
      category: r.category,
      type: r.type,
      isImpulse: false,
      note: r.note,
      dateISO: r.dateISO,
    }));
}

/** Total of the rows currently kept, for the confirm button. */
export function reviewTotals(rows: readonly ReviewRow[]): { expense: number; income: number; count: number } {
  let expense = 0;
  let income = 0;
  let count = 0;
  for (const r of rows) {
    if (!r.include || r.amount <= 0) continue;
    count += 1;
    if (r.type === 'Income') income += r.amount;
    else expense += r.amount;
  }
  return { expense, income, count };
}
