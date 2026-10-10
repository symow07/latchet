import { test, expect, afterAll } from 'bun:test';
import { setLocale, getLocale, t } from './core';
import { applyChosenLocale } from './apply';

afterAll(() => setLocale('en'));

test('a chosen language survives a persist step that re-applies the old one', async () => {
  // Reinstates the bug exactly: the settings write reads the row on its way
  // through and applies the language it still holds. The choice was saved
  // correctly, so every "did it save?" check passed, while the interface
  // stayed in the old language.
  setLocale('en');
  await applyChosenLocale('fr', async () => { setLocale('en'); });
  expect(getLocale()).toBe('fr');
});

test('what t() returns is the chosen language, not just what was stored', async () => {
  setLocale('en');
  await applyChosenLocale('fr', async () => { setLocale('en'); });
  expect(t('business.label')).toBe('Entreprise');
});

test('a failing persist still applies the language', async () => {
  // Losing the preference on next launch is bad; refusing to change language
  // at all because a write failed is worse.
  setLocale('en');
  await applyChosenLocale('zh', async () => { throw new Error('offline'); });
  expect(getLocale()).toBe('zh');
});
