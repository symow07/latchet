/**
 * A category's glyph.
 *
 * The identity marks a category by a glyph on a soft tile, never by a colour
 * (DESIGN-IDENTITY.md §Palette, "No category rainbow"). Every list of
 * transactions takes its marks from here, so a category looks the same on
 * every screen.
 *
 * Built-in categories are keyed by their stored name: the personal ones (see
 * category-meta.ts) and the business expense ones (expense-meta.ts). The two
 * sets share Transport and Other; Meals and Food are different stored names
 * for the same glyph. A user's own category falls back to a tag.
 */
import {
  Airplane,
  Building2,
  Car,
  Dumbbell,
  Laptop,
  MoneyIn,
  Package,
  Repeat,
  ShoppingBag,
  Tag,
  Utensils,
  type IconComponent,
} from '@/components/icons';

const BY_CATEGORY: Record<string, IconComponent> = {
  Food: Utensils,
  Gym: Dumbbell,
  Transport: Car,
  Shopping: ShoppingBag,
  Subscriptions: Repeat,
  Other: Package,
  // Business expense categories.
  Travel: Airplane,
  Software: Laptop,
  Meals: Utensils,
  Office: Building2,
};

/** The glyph for a stored category name. Income always reads as money in. */
export function categoryIcon(category: string, type?: 'Income' | 'Expense' | string): IconComponent {
  if (type === 'Income') return MoneyIn;
  return BY_CATEGORY[category] ?? Tag;
}
