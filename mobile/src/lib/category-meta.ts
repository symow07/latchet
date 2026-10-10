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

/**
 * Where each built-in sits in the eight-step ramp, by hand.
 *
 * The ramp runs violet, blue, teal, green, amber, orange, red, pink — so each
 * category keeps the hue `DEFAULT_CATEGORIES` above always gave it: Food was
 * `#fb923c` and is orange, Transport was `#60a5fa` and is blue, Shopping was
 * `#f472b6` and is pink. The ramp changed; what a category *means* did not.
 *
 * Assigned rather than hashed because six known names over eight buckets is
 * not a hashing problem, it is a list. FNV put them at 1/0/2/5/5/5: Shopping,
 * Subscriptions and Other all landed on slot 5, so half the rows in a six-row
 * list were the same orange while three of the eight colours went unused.
 */
const BUILT_IN_MARK: Record<string, number> = {
  Subscriptions: 0, // violet
  Transport: 1,     // blue
  Other: 2,         // teal
  Gym: 3,           // green
  Food: 5,          // orange
  Shopping: 7,      // pink
};

/**
 * Which of the eight categorical marks a category gets.
 *
 * DESIGN-PROMPT.md §2.5 replaces the per-category brand colours above with one
 * eight-step ramp verified against both grounds — the old `#fb923c`/`#34d399`
 * set belongs to the loud direction and out-shouts the accent. The ramp is a
 * palette token, so this returns an index rather than a colour: the same
 * category then reads correctly in light and in dark.
 *
 * Built-ins take their assigned slot. Anything else — a category the user
 * invented, or a merchant name, which `subscriptions` and `accounts` also pass
 * through here — is hashed, so it gets a stable colour instead of whichever
 * slot it happened to be created in. A custom category can still land on the
 * same hue as a built-in; with eight slots that is unavoidable and it is not
 * what made the old behaviour look broken.
 *
 * Changing the assignment moves existing rows to new colours. That is fine:
 * the mark is decoration, the name beside it carries the meaning, and the
 * arrangement it replaces had three of six identical.
 */
export function categoryMarkIndex(name: string, steps: number): number {
  if (steps <= 0) return 0;

  const assigned = BUILT_IN_MARK[name];
  // Modulo rather than a direct index: the ramp is eight steps today, and a
  // shorter one must still land inside it rather than return undefined.
  if (assigned !== undefined) return assigned % steps;

  // FNV-1a. Small, stable across platforms, and good enough spread for eight
  // buckets — the only requirement is that it never changes between releases.
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % steps;
}
