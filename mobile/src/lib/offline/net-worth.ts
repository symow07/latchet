/**
 * Net-worth snapshots: the breakdown's two shapes and the new-snapshot form,
 * with no React and no SQLite, so `bun test` holds them in every timezone.
 *
 * A breakdown travels and is stored as the JSON text of an object of amounts
 * (I-WIRE-4) — the server has always stored it that way, which is why the
 * screen, reading an object, never showed one. db.ts parses it on the way out
 * with parseBreakdown and writes it with serializeBreakdown (breakdown.ts);
 * nothing else sees the text.
 */
import { todayISO } from '../dates';
import { MAX_AMOUNT } from './limits';
import type { Breakdown } from './breakdown';

export { parseBreakdown, serializeBreakdown, type Breakdown } from './breakdown';

export const ASSET_KEYS = ['cashSavings', 'investments', 'realEstate', 'otherAssets'] as const;
export const LIABILITY_KEYS = ['creditCardDebt', 'loans', 'mortgage', 'otherLiabilities'] as const;
export type BreakdownKey = (typeof ASSET_KEYS)[number] | (typeof LIABILITY_KEYS)[number];

/** The lines the latest snapshot's breakdown shows, in form order, liabilities signed. */
export function breakdownLines(
  breakdown: Breakdown | null,
): { key: BreakdownKey; value: number; liability: boolean }[] {
  if (!breakdown) return [];
  const lines: { key: BreakdownKey; value: number; liability: boolean }[] = [];
  for (const key of ASSET_KEYS) {
    const value = breakdown[key] ?? 0;
    if (value > 0) lines.push({ key, value, liability: false });
  }
  for (const key of LIABILITY_KEYS) {
    const value = breakdown[key] ?? 0;
    if (value > 0) lines.push({ key, value, liability: true });
  }
  return lines;
}

/** What the user typed, by field. */
export type SnapshotForm = Record<BreakdownKey, string>;

export const EMPTY_SNAPSHOT_FORM: SnapshotForm = {
  cashSavings: '',
  investments: '',
  realEstate: '',
  otherAssets: '',
  creditCardDebt: '',
  loans: '',
  mortgage: '',
  otherLiabilities: '',
};

/**
 * A typed amount; blank, unreadable or negative is 0 (a debt is entered as a
 * liability, not as a negative asset). Thousands separators are ignored.
 */
export function parseFormAmount(str: string): number {
  const n = parseFloat(str.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function snapshotTotals(form: SnapshotForm): { assets: number; liabilities: number; netWorth: number } {
  const assets = ASSET_KEYS.reduce((sum, k) => sum + parseFormAmount(form[k]), 0);
  const liabilities = LIABILITY_KEYS.reduce((sum, k) => sum + parseFormAmount(form[k]), 0);
  return { assets, liabilities, netWorth: assets - liabilities };
}

export interface SnapshotInput {
  /** The local calendar date it was taken: the user's today, not UTC's. */
  date: string;
  assets: number;
  liabilities: number;
  breakdown: Breakdown;
}

/**
 * The snapshot the form describes, dated today in the device's own zone — the
 * old screen took toISOString()'s date, which is already tomorrow east of
 * UTC in the evening and still yesterday west of it in the morning. An error
 * (a locale key) when nothing was entered, or an amount is past what the
 * server stores, which it would refuse at the next sync with no one there to
 * see it.
 */
export function snapshotFromForm(
  form: SnapshotForm,
  now: Date = new Date(),
): { ok: true; snapshot: SnapshotInput } | { ok: false; error: string | null } {
  const breakdown: Breakdown = {};
  for (const key of [...ASSET_KEYS, ...LIABILITY_KEYS]) {
    const value = parseFormAmount(form[key]);
    if (value > 0) breakdown[key] = value;
  }
  const { assets, liabilities } = snapshotTotals(form);
  if (assets <= 0 && liabilities <= 0) return { ok: false, error: null };
  if (assets > MAX_AMOUNT || liabilities > MAX_AMOUNT) return { ok: false, error: 'common.amountTooLarge' };
  return { ok: true, snapshot: { date: todayISO(now), assets, liabilities, breakdown } };
}

/** Newest first: by date, then by when it was taken. */
export function sortSnapshotsNewestFirst<T extends { date: string; createdAt: string; id: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? -1 : 1,
  );
}
