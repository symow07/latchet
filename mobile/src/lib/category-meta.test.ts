import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// ── No render site may bypass categoryLabel ─────────────────────────────────
//
// The first pass at this missed six call sites — analytics, bill reminders and
// the import preview all still printed the stored English name. Grepping is the
// only thing that catches that reliably, so it is a test rather than a habit.


/**
 * Business-mode expenses use their own vocabulary (Travel, Software, Meals…)
 * and their own namespace — see expense-meta. They are localised too, so
 * nothing is excluded here any more.
 */
const KNOWN_UNLOCALISED: string[] = [];

function screenFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) screenFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

test('no screen renders a stored category name directly', () => {
  const offenders: string[] = [];

  for (const file of screenFiles(join(import.meta.dir, '..', 'app'))) {
    if (KNOWN_UNLOCALISED.some((k) => file.endsWith(k))) continue;

    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // A category value interpolated into JSX...
        const renders = /\{\s*[a-zA-Z]+\.(category|suggestedCategory)\s*\}|\{\s*(cat|category)\.name\s*\}/.test(line);
        // ...that is not going through categoryLabel, and is not a React key.
        if (renders && !line.includes('categoryLabel') && !line.includes('key=')) {
          offenders.push(`${file.split('/app/')[1]}:${i + 1}`);
        }
      });
  }

  expect(offenders).toEqual([]);
});

test('every built-in category has a label in all three languages', () => {
  for (const locale of ['en', 'fr', 'zh'] as const) {
    const json = JSON.parse(
      readFileSync(join(import.meta.dir, 'i18n', 'locales', `${locale}.json`), 'utf8')
    ) as { categories?: Record<string, string> };

    for (const { name } of DEFAULT_CATEGORIES) {
      expect(json.categories?.[name]).toBeTruthy();
    }
  }
});

test('the parameterised budget title exists in every language, with the placeholder', () => {
  // "%{category} Budget" in English, "Budget %{category}" in French — a
  // concatenation could not express that.
  for (const locale of ['en', 'fr', 'zh'] as const) {
    const json = JSON.parse(
      readFileSync(join(import.meta.dir, 'i18n', 'locales', `${locale}.json`), 'utf8')
    ) as { categoryBudgets?: { titleFor?: string } };

    expect(json.categoryBudgets?.titleFor).toContain('%{category}');
  }
});
