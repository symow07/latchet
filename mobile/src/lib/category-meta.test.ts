import { test, expect, afterEach } from 'bun:test';
import {
  categoryLabel,
  isBuiltInCategory,
  categoryMeta,
  DEFAULT_CATEGORIES,
  type CategoryMeta,
} from './category-meta';
import { setLocale } from './i18n/core';

afterEach(() => setLocale('en'));

const custom = (name: string): CategoryMeta => ({
  name,
  icon: '🏷️',
  color: '#94a3b8',
  custom: true,
});

// ── The constraint: display translates, identity does not ────────────────────

test('a built-in category is translated for display', () => {
  setLocale('fr');
  expect(categoryLabel('Food')).toBe('Alimentation');
  setLocale('zh');
  expect(categoryLabel('Food')).toBe('餐饮');
});

test('translating never mutates the stored name', () => {
  // The label is derived; the name a transaction stores is untouched. Analytics
  // group on it, the backend validates it, and devices in different languages
  // sync it — a translated value would break all three.
  setLocale('fr');
  for (const c of DEFAULT_CATEGORIES) {
    const before = c.name;
    categoryLabel(c.name);
    expect(c.name).toBe(before);
  }
  expect(DEFAULT_CATEGORIES.map((c) => c.name)).toEqual([
    'Food',
    'Gym',
    'Transport',
    'Shopping',
    'Subscriptions',
    'Other',
  ]);
});

test('a custom category is never translated', () => {
  // The user typed it in their own language. Running "Épicerie" through a
  // translation table would either miss or, worse, match something.
  setLocale('fr');
  const all = [...DEFAULT_CATEGORIES, custom('Épicerie')];
  expect(categoryLabel('Épicerie', all)).toBe('Épicerie');

  setLocale('zh');
  expect(categoryLabel('Épicerie', all)).toBe('Épicerie');
});

test('a custom category sharing a built-in name stays the user\'s', () => {
  setLocale('fr');
  const all = [custom('Food')];
  // They made their own "Food"; it is not our "Food".
  expect(categoryLabel('Food', all)).toBe('Food');
  // Without that context it is the built-in, and translates.
  expect(categoryLabel('Food', DEFAULT_CATEGORIES)).toBe('Alimentation');
});

test('an unknown category is returned as-is, not blanked', () => {
  // A row synced from a device on an older version, say.
  setLocale('fr');
  expect(categoryLabel('Cryptocurrency')).toBe('Cryptocurrency');
  expect(categoryLabel('')).toBe('');
});

test('every built-in has a translation in every language', () => {
  for (const locale of ['en', 'fr', 'zh'] as const) {
    setLocale(locale);
    for (const c of DEFAULT_CATEGORIES) {
      const label = categoryLabel(c.name);
      // A missing key would surface as the key path itself.
      expect(label).not.toContain('categories.');
      expect(label.length).toBeGreaterThan(0);
    }
  }
});

test('French and Chinese actually differ from English', () => {
  // Guards against a locale file that silently fell back for every key.
  setLocale('en');
  const en = DEFAULT_CATEGORIES.map((c) => categoryLabel(c.name));
  setLocale('fr');
  const fr = DEFAULT_CATEGORIES.map((c) => categoryLabel(c.name));
  setLocale('zh');
  const zh = DEFAULT_CATEGORIES.map((c) => categoryLabel(c.name));

  expect(fr).not.toEqual(en);
  expect(zh).not.toEqual(en);
  // "Transport" is legitimately identical in French, so compare the whole set.
  expect(zh.every((label, i) => label !== en[i])).toBe(true);
});

// ── isBuiltInCategory ────────────────────────────────────────────────────────

test('built-in detection distinguishes ours from theirs', () => {
  expect(isBuiltInCategory('Food')).toBe(true);
  expect(isBuiltInCategory('Épicerie')).toBe(false);
  expect(isBuiltInCategory('Food', [custom('Food')])).toBe(false);
});

// ── categoryMeta ─────────────────────────────────────────────────────────────

test('icon and colour come back for known categories', () => {
  expect(categoryMeta('Food', DEFAULT_CATEGORIES).icon).toBe('🍔');
});

test('an unknown category still gets a usable icon and colour', () => {
  const meta = categoryMeta('Cryptocurrency', DEFAULT_CATEGORIES);
  expect(meta.name).toBe('Cryptocurrency');
  expect(meta.icon).toBeTruthy();
  expect(meta.color).toBeTruthy();
});
