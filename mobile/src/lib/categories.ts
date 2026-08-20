import { getCustomCategories } from './db';
import { DEFAULT_CATEGORIES, type CategoryMeta } from './category-meta';

/**
 * Central category system. The built-in categories plus any the user creates,
 * merged into one list. Transaction rows store the category *name* (a string),
 * so custom categories work everywhere; this module supplies the icon/color for
 * rendering and the create/palette helpers.
 */

export {
  DEFAULT_CATEGORIES,
  CATEGORY_EMOJIS,
  CATEGORY_COLORS,
  categoryMeta,
  categoryLabel,
  isBuiltInCategory,
  type CategoryMeta,
} from './category-meta';

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


