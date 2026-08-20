/**
 * Category identity, display, and the line between them.
 *
 * A transaction stores its category *name* — a plain string, canonical and in
 * English. That value is the identity: analytics group on it, the import
 * parser's keyword map produces it, budgets key on it, it travels to the
 * backend, and it syncs between devices that may be set to different
 * languages. It must never be translated.
 *
 * What the user reads is a different thing, and `categoryLabel` is the only
 * way to produce it. Custom categories are excluded on purpose: the user typed
 * those in their own language, and running "Épicerie" through a translation
 * table would either fail to match or, worse, match something.
 *
 * Dependency-free so that rule can be tested.
 */
import { t } from './i18n/core';

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

const BUILT_IN_NAMES = new Set(DEFAULT_CATEGORIES.map((c) => c.name));

/** True when a name is one of ours rather than one the user invented. */
export function isBuiltInCategory(name: string, all?: CategoryMeta[]): boolean {
  if (!BUILT_IN_NAMES.has(name)) return false;
  // A user-created category that happens to share a built-in name is still
  // theirs, and is left exactly as they typed it.
  const known = all?.find((c) => c.name === name);
  return !known?.custom;
}

/**
 * What to show the user for a category. Never what to store.
 *
 * Built-ins translate; custom names come back untouched. An unknown name — a
 * category from a device on an older version, say — is returned as-is rather
 * than blanked.
 */
export function categoryLabel(name: string, all?: CategoryMeta[]): string {
  if (!name) return name;
  return isBuiltInCategory(name, all) ? t(`categories.${name}`) : name;
}

/**
 * Icon/color for a category name, with a sensible fallback for legacy or
 * unknown names.
 */
export function categoryMeta(name: string, all: CategoryMeta[]): CategoryMeta {
  return (
    all.find((c) => c.name === name) ??
    DEFAULT_CATEGORIES.find((c) => c.name === name) ?? {
      name,
      icon: '🏷️',
      color: '#94a3b8',
    }
  );
}

// Palettes offered when creating a new category.
export const CATEGORY_EMOJIS = [
  '🍔', '☕', '🛒', '🏠', '🚗', '✈️', '💊', '🎮', '🎬', '📚', '💡', '🐾',
  '👕', '💇', '🎁', '💰', '📈', '🏥', '⛽', '🍺', '🎵', '🏦', '🧾', '🏷️',
];
export const CATEGORY_COLORS = [
  '#fb923c', '#34d399', '#60a5fa', '#f472b6', '#c084fc', '#f59e0b',
  '#22c55e', '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf', '#eab308',
];
