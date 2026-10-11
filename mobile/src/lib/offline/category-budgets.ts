/**
 * Category budgets, the screen's logic: which lines it shows and what a typed
 * limit means. No React and no SQLite, so `bun test` holds it.
 *
 * A budget is keyed by its category, here as on the server and on the wire
 * (I-WIRE-4): setting one for a category that has one replaces it.
 */
import { MAX_AMOUNT } from './limits';

export interface BudgetLine<C> {
  /** The category's name: the budget's key. */
  name: string;
  /** The category as the app knows it; null for a budget whose category is gone. */
  category: C | null;
  budget: { category: string; amount: number } | null;
}

/**
 * One line per category, in the categories' order, and after them one per
 * budget whose category no longer exists — a custom category deleted, or
 * renamed (which is a delete and a create: a budget is keyed by the old name).
 * Such a budget was invisible before, so it could not be removed; listed, it
 * can be.
 */
export function budgetLines<C extends { name: string }, B extends { category: string; amount: number }>(
  categories: readonly C[],
  budgets: readonly B[],
): BudgetLine<C>[] {
  const byCategory = new Map(budgets.map((b) => [b.category, b]));
  const lines: BudgetLine<C>[] = categories.map((c) => ({ name: c.name, category: c, budget: byCategory.get(c.name) ?? null }));
  const known = new Set(categories.map((c) => c.name));
  for (const b of budgets) {
    if (!known.has(b.category)) lines.push({ name: b.category, category: null, budget: b });
  }
  return lines;
}

/** A typed limit, or null when it is not one the server would keep. */
export function parseBudgetLimit(input: string): number | null {
  const value = parseFloat(input);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;
  return value;
}
