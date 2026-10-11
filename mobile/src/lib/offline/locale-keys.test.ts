import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../i18n/locales/en.json';

/**
 * These modules return locale keys for the screens to translate (an error,
 * run-now's message), so the i18n test's scan for t('…') never sees them.
 * Every key-shaped string literal in them must exist in English — and so, by
 * i18n.test.ts, in every language.
 */
test('every locale key the offline modules hand to a screen exists', () => {
  const lookup = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), en);
  const keys = new Set<string>();
  for (const file of readdirSync(import.meta.dir)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue;
    const source = readFileSync(join(import.meta.dir, file), 'utf8');
    for (const m of source.matchAll(/'((?:common|recurring|billReminders|netWorth|categoryBudgets)\.[A-Za-z]+)'/g)) keys.add(m[1]!);
  }
  expect(keys.size).toBeGreaterThan(5);
  expect([...keys].filter((k) => typeof lookup(k) !== 'string')).toEqual([]);
});
