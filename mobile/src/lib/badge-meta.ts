/**
 * Achievement badges: identity versus display.
 *
 * The same rule as lib/category-meta and lib/expense-meta, and for a sharper
 * reason. A badge is persisted by name — `Achievement.badge` in the schema,
 * under `@@unique([userId, badge])`, and the schema calls it "the badge key".
 * Translating the stored string would not merely change a label: it would fail
 * to match the row already earned, so a French user would appear to lose every
 * badge and then earn duplicates of them.
 *
 * So the badge stays canonical English wherever it is stored, sent or
 * compared, and only what the user reads is translated.
 *
 * Dependency-free so the display/storage split can be tested.
 */
import { t } from './i18n/core';

/** Every badge calculateBadges can award. Canonical English, never translated. */
export const BADGE_KEYS = [
  '0 Impulse Day',
  '7-Day Streak',
  '30-Day Streak',
  'Budget Master',
  'No Subscriptions',
] as const;

export type BadgeKey = (typeof BADGE_KEYS)[number];

const SLUGS: Record<string, string> = {
  '0 Impulse Day': 'zeroImpulse',
  '7-Day Streak': 'streak7',
  '30-Day Streak': 'streak30',
  'Budget Master': 'budgetMaster',
  'No Subscriptions': 'noSubscriptions',
};

/**
 * What to show the user for a stored badge key.
 *
 * An unknown key falls through to itself rather than to a raw translation key,
 * so a badge added on the server before the app ships a string for it reads as
 * slightly untranslated instead of as `badges.somethingNew`.
 */
export function badgeLabel(badge: string): string {
  const slug = SLUGS[badge];
  if (!slug) return badge;
  return t(`badges.${slug}`, { defaultValue: badge });
}
