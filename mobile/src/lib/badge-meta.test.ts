import { test, expect, afterEach } from 'bun:test';
import { badgeLabel, BADGE_KEYS } from './badge-meta';
import { getUnlockedBadges } from './calculations';
import { setLocale } from './i18n/core';

afterEach(() => setLocale('en'));

// The stakes here are higher than a mistranslated label. Achievement.badge is
// persisted under @@unique([userId, badge]) and the schema calls it "the badge
// key", so a translated value would not match the row already earned — a French
// user would appear to lose every badge and then earn duplicates.

test('the stored keys stay canonical English in every locale', () => {
  for (const locale of ['en', 'fr', 'zh'] as const) {
    setLocale(locale);
    const badges = getUnlockedBadges(
      [],            // no transactions
      0,             // streak
      0,             // monthly spent
      0,             // monthly budget
    );
    for (const b of badges) {
      expect(BADGE_KEYS).toContain(b as (typeof BADGE_KEYS)[number]);
      expect(b).toMatch(/^[\x20-\x7E]+$/); // ASCII: never a translated string
    }
  }
});

test('the display label translates while the key does not', () => {
  setLocale('en');
  expect(badgeLabel('Budget Master')).toBe('Budget Master');
  setLocale('fr');
  expect(badgeLabel('Budget Master')).toBe('Maître du budget');
  setLocale('zh');
  expect(badgeLabel('Budget Master')).toBe('预算达人');
});

test('every awardable key has a label in every locale', () => {
  for (const locale of ['en', 'fr', 'zh'] as const) {
    setLocale(locale);
    for (const key of BADGE_KEYS) {
      const label = badgeLabel(key);
      expect(label.length).toBeGreaterThan(0);
      // a missing key would surface as the raw path
      expect(label).not.toContain('badges.');
    }
  }
});

test('an unknown key falls back to itself, not to a translation path', () => {
  // A badge added on the server before the app ships a string for it should
  // read as slightly untranslated, never as "badges.somethingNew".
  setLocale('fr');
  expect(badgeLabel('Some Future Badge')).toBe('Some Future Badge');
});
