import { getCustomCategories } from './db';

/**
 * Central category system. The built-in categories plus any the user creates,
 * merged into one list. Transaction rows store the category *name* (a string),
 * so custom categories work everywhere; this module supplies the icon/color for
 * rendering and the create/palette helpers.
 */

export interface CategoryMeta {
  name: string;
  icon: string; // emoji
  color: string;
  custom?: boolean;
}

export const DEFAULT_CATEGORIES: CategoryMeta[] = [
  { name: 'Food', icon: '🍔', color: '#fb923c' },
  { name: 'Gym', icon: '💪', color: '#34d399' },
  { name: 'Transport', icon: '🚗', color: '#60a5fa' },
  { name: 'Shopping', icon: '🛍️', color: '#f472b6' },
  { name: 'Subscriptions', icon: '📱', color: '#c084fc' },
  { name: 'Other', icon: '📦', color: '#94a3b8' },
];

// Palettes offered when creating a new category.
export const CATEGORY_EMOJIS = [
  '🍔', '☕', '🛒', '🏠', '🚗', '✈️', '💊', '🎮', '🎬', '📚', '💡', '🐾',
  '👕', '💇', '🎁', '💰', '📈', '🏥', '⛽', '🍺', '🎵', '🏦', '🧾', '🏷️',
];
export const CATEGORY_COLORS = [
  '#fb923c', '#34d399', '#60a5fa', '#f472b6', '#c084fc', '#f59e0b',
  '#22c55e', '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf', '#eab308',
];

/** Built-in categories + custom ones, de-duplicated, with "Other" kept last. */
export async function getCategories(): Promise<CategoryMeta[]> {
  const custom = await getCustomCategories();
  const customMeta: CategoryMeta[] = custom.map((c) => ({
    name: c.name, icon: c.icon, color: c.color, custom: true,
  }));
  const customNames = new Set(customMeta.map((c) => c.name.toLowerCase()));

  const other = DEFAULT_CATEGORIES.find((c) => c.name === 'Other')!;
  const defaults = DEFAULT_CATEGORIES
    .filter((c) => c.name !== 'Other')
    .filter((c) => !customNames.has(c.name.toLowerCase()));

  return [...defaults, ...customMeta.filter((c) => c.name.toLowerCase() !== 'other'), other];
}

/** Resolve icon/color for a category name against a loaded list, with a
 *  sensible fallback for legacy/unknown names. */
export function categoryMeta(name: string, all: CategoryMeta[]): CategoryMeta {
  return (
    all.find((c) => c.name === name) ??
    DEFAULT_CATEGORIES.find((c) => c.name === name) ??
    { name, icon: '🏷️', color: '#94a3b8' }
  );
}
