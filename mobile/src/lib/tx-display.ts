/**
 * Display labels for values that are stored in English.
 *
 * A transaction's `type` and an account's `type` are identity, not prose: they
 * are written to SQLite, validated against a fixed enum by the backend, and
 * synced between devices that may be set to different languages. Rendering
 * them straight into the UI — which several screens did — shows "Expense" to a
 * French user.
 *
 * The same rule as category-meta: translate the display, never the value.
 */
import { t } from './i18n/core';

export type TransactionType = 'Expense' | 'Income';

/** "Expense" → "Dépense". Unknown values are returned unchanged. */
export function txTypeLabel(type: string): string {
  if (type !== 'Expense' && type !== 'Income') return type;
  return t(`txTypes.${type}`);
}

/**
 * "savings" → "Épargne".
 *
 * The stored set is cash | checking | savings | credit | investment | other;
 * the key for `credit` is `creditCard`, which is what the existing table calls
 * it. Anything unrecognised falls back to the raw value rather than showing a
 * missing-key marker.
 */
const ACCOUNT_TYPE_KEYS: Record<string, string> = {
  cash: 'cash',
  checking: 'checking',
  savings: 'savings',
  credit: 'creditCard',
  investment: 'investment',
  other: 'other',
};

export function accountTypeLabel(type: string): string {
  const key = ACCOUNT_TYPE_KEYS[type];
  return key ? t(`accountTypes.${key}`) : type;
}
