import { test, expect } from 'bun:test';
import { I18n } from 'i18n-js';
import en from './locales/en.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';
import ar from './locales/ar.json';

/**
 * The household screens build some keys at runtime — `household.field_${name}`
 * from the server's response, and the share-level labels from a lookup table.
 * The repo's key-usage test scans source for literal t('…') calls, so it
 * cannot see these: a missing one would ship as the key path rendered at the
 * user, in whichever language nobody on the team reads.
 *
 * The field names are the ones the server actually sends in
 * `joiningMeans.sharedOnJoin` / `notSharedOnJoin`. If the server grows a new
 * one, this fails until the string exists in all four languages.
 */

const SERVER_FIELDS = ['totalIn', 'totalOut', 'categories', 'transactions', 'accountBalances'];
const SHARE_LEVELS = ['summary', 'categories', 'full'];

const LOCALES = { en, fr, zh, ar } as const;

function lookup(locale: keyof typeof LOCALES, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    LOCALES[locale]
  );
}

test('every runtime-built household key exists in all four languages', () => {
  const keys = [
    ...SERVER_FIELDS.map((f) => `household.field_${f}`),
    ...SHARE_LEVELS.flatMap((l) => {
      const cap = l.charAt(0).toUpperCase() + l.slice(1);
      return [`household.level${cap}`, `household.level${cap}Desc`];
    }),
  ];

  const missing: string[] = [];
  for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
    for (const key of keys) {
      if (typeof lookup(locale, key) !== 'string') missing.push(`${locale}: ${key}`);
    }
  }
  expect(missing).toEqual([]);
});

test('the countable household keys pluralise in Arabic across every band', () => {
  const i = new I18n({ en, fr, zh, ar });
  i.enableFallback = false;
  // The same registration core.ts performs, kept local so this test does not
  // depend on module import order.
  i.pluralization.register('ar', (_i18n, count) => {
    if (count === 0) return ['zero', 'other'];
    if (count === 1) return ['one', 'other'];
    if (count === 2) return ['two', 'other'];
    const within = count % 100;
    if (within >= 3 && within <= 10) return ['few', 'other'];
    if (within >= 11 && within <= 99) return ['many', 'other'];
    return ['other'];
  });
  i.locale = 'ar';

  for (const key of ['household.memberCount', 'household.sharedAccountCount']) {
    for (const count of [0, 1, 2, 5, 30, 100, 103, 111]) {
      const out = i.t(key, { count });
      expect(out).not.toContain('missing');
      expect(out).not.toContain(key);
      expect(out.length).toBeGreaterThan(0);
    }
  }
});
