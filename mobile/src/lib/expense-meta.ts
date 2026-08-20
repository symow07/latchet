/**
 * Business expense categories and statuses: identity versus display.
 *
 * The same rule as lib/category-meta, and for the same reason. An expense
 * stores its category as a canonical English string, and the backend validates
 * it against a fixed enum (routes/expenses.ts), so the stored value can never
 * be translated. What the reviewer reads is a separate thing.
 *
 * This is a different vocabulary from transaction categories — Travel,
 * Software, Meals rather than Food, Gym, Transport — so it gets its own
 * namespace rather than being folded into the other table, where "Transport"
 * appearing in both would be a coincidence rather than a shared meaning.
 *
 * Dependency-free so the display/storage split can be tested.
 */
import { t } from './i18n/core';

export const EXPENSE_CATEGORIES = [
  'Travel',
  'Software',
  'Meals',
  'Transport',
  'Office',
  'Other',
] as const;
export type ExpenseCategoryName = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ExpenseStatusName = (typeof EXPENSE_STATUSES)[number];

const CATEGORY_NAMES = new Set<string>(EXPENSE_CATEGORIES);
const STATUS_NAMES = new Set<string>(EXPENSE_STATUSES);

/**
 * What to show for an expense category. Never what to store.
 *
 * An unrecognised value — from a newer client, say — comes back unchanged
 * rather than blank.
 */
export function expenseCategoryLabel(category: string): string {
  if (!category) return category;
  return CATEGORY_NAMES.has(category) ? t(`expenseCategories.${category}`) : category;
}

/** Display label for an expense's review status. */
export function expenseStatusLabel(status: string): string {
  if (!status) return status;
  return STATUS_NAMES.has(status) ? t(`expenseStatuses.${status}`) : status;
}
