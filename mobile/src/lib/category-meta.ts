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

/**
 * The identity's warm light ramp (palettes.ts `C_LIGHT.cat`), espresso through
 * platinum. Stored colours are always light-ramp values; a screen that draws
 * one resolves it into the active scheme's `cat` ramp by index, the way
 * accounts.tsx does. Never a rainbow (DESIGN-IDENTITY.md, "No category
 * rainbow"): a category is identified by its glyph, not its colour.
 */
const WARM_RAMP = [
  '#3B2A21', // espresso
  '#6A4A38', // cocoa
  '#8A5F45', // umber
  '#9C6B3F', // caramel
  '#7D6A4F', // bronze
  '#6E6862', // stone
  '#4F4A45', // graphite
  '#84807A', // platinum
] as const;

/** Each built-in's colour is its slot in `BUILT_IN_MARK` below, so the two never disagree. */
export const DEFAULT_CATEGORIES: CategoryMeta[] = [
  { name: 'Food', icon: '🍔', color: WARM_RAMP[5] },
  { name: 'Gym', icon: '💪', color: WARM_RAMP[3] },
  { name: 'Transport', icon: '🚗', color: WARM_RAMP[1] },
  { name: 'Shopping', icon: '🛍️', color: WARM_RAMP[7] },
  { name: 'Subscriptions', icon: '📱', color: WARM_RAMP[0] },
  { name: 'Other', icon: '📦', color: WARM_RAMP[2] },
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
      color: WARM_RAMP[7],
    }
  );
}

// Choices offered when creating a new category.
export const CATEGORY_EMOJIS = [
  '🍔', '☕', '🛒', '🏠', '🚗', '✈️', '💊', '🎮', '🎬', '📚', '💡', '🐾',
  '👕', '💇', '🎁', '💰', '📈', '🏥', '⛽', '🍺', '🎵', '🏦', '🧾', '🏷️',
];
/**
 * Colours a new category can be saved with: the warm ramp, then its first four
 * again (the list has always been twelve long). The add sheet draws the eight
 * swatches from the active scheme's `cat` ramp and saves the light value at
 * the same index, so what is stored never depends on the scheme it was picked in.
 */
export const CATEGORY_COLORS: string[] = [...WARM_RAMP, ...WARM_RAMP.slice(0, 4)];

/**
 * Where each built-in sits in the eight-step ramp, by hand.
 *
 * The ramp is the identity's warm one, espresso through platinum. The slots
 * date from the old rainbow ramp and are kept so no category changes place;
 * they now name tones of one warm family rather than hues.
 *
 * Assigned rather than hashed because six known names over eight buckets is
 * not a hashing problem, it is a list. FNV put them at 1/0/2/5/5/5: Shopping,
 * Subscriptions and Other all landed on slot 5, so half the rows in a six-row
 * list were the same tone while three of the eight went unused.
 */
const BUILT_IN_MARK: Record<string, number> = {
  Subscriptions: 0, // espresso
  Transport: 1,     // cocoa
  Other: 2,         // umber
  Gym: 3,           // caramel
  Food: 5,          // stone
  Shopping: 7,      // platinum
};

/**
 * Which of the eight categorical marks a category gets.
 *
 * The marks come from the eight-step `cat` palette token, the identity's warm
 * ramp verified against both grounds, not from per-category brand colours.
 * Because it is a token, this returns an index rather than a colour: the same
 * category then reads correctly in light and in dark.
 *
 * Built-ins take their assigned slot. Anything else — a category the user
 * invented, or a merchant name, which `subscriptions` and `accounts` also pass
 * through here — is hashed, so it gets a stable colour instead of whichever
 * slot it happened to be created in. A custom category can still land on the
 * same tone as a built-in; with eight slots that is unavoidable and it is not
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
