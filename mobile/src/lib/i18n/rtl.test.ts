import { test, expect } from 'bun:test';
import { isRtlLocale, rtlRestartRequired } from './rtl';

test('Arabic reads right-to-left and the others do not', () => {
  expect(isRtlLocale('ar')).toBe(true);
  for (const ltr of ['en', 'fr', 'zh'] as const) expect(isRtlLocale(ltr)).toBe(false);
});

test('switching between two left-to-right languages needs no restart', () => {
  // The running layout is already correct; asking someone to relaunch for
  // English → French would be noise.
  expect(rtlRestartRequired('fr', false)).toBe(false);
  expect(rtlRestartRequired('en', false)).toBe(false);
});

test('switching into or out of Arabic needs one', () => {
  expect(rtlRestartRequired('ar', false)).toBe(true);
  expect(rtlRestartRequired('en', true)).toBe(true);
});

test('choosing Arabic while already in Arabic does not', () => {
  expect(rtlRestartRequired('ar', true)).toBe(false);
});
