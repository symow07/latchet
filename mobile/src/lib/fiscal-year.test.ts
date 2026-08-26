import { test, expect } from 'bun:test';
import { monthNames, normaliseFiscalMonth } from './fiscal-year';
import { setLocale } from './i18n/core';

test('there are twelve months and none repeats', () => {
  // A formatter fed the wrong day can roll a month into the next one, which
  // shows up as a duplicate rather than an error.
  const names = monthNames();
  expect(names).toHaveLength(12);
  expect(new Set(names).size).toBe(12);
});

test('month names follow the app language', () => {
  setLocale('fr');
  expect(monthNames()[0].toLowerCase()).toBe('janvier');
  setLocale('en');
  expect(monthNames()[0].toLowerCase()).toBe('january');
});

test('the picker\'s cleared value becomes null, not zero', () => {
  // The backend accepts 1-12 or null and rejects 0, so sending the picker's
  // own "cleared" sentinel straight through would fail the save.
  expect(normaliseFiscalMonth(0)).toBeNull();
  expect(normaliseFiscalMonth(null)).toBeNull();
});

test('out-of-range months are refused rather than stored', () => {
  expect(normaliseFiscalMonth(13)).toBeNull();
  expect(normaliseFiscalMonth(-1)).toBeNull();
});

test('a real month passes through', () => {
  expect(normaliseFiscalMonth(1)).toBe(1);
  expect(normaliseFiscalMonth(12)).toBe(12);
});

test('the month list does not shift with the device timezone', () => {
  // Built from Date.UTC, so formatting in local time renders each date as the
  // previous month west of Greenwich — the list began at December in Los
  // Angeles and every month the user picked was off by one.
  const names = monthNames();
  expect(names[0].toLowerCase()).toBe('january');
  expect(names[11].toLowerCase()).toBe('december');
});
