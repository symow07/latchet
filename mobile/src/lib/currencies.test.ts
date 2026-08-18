import { test, expect } from 'bun:test';
import {
  convertCurrency,
  setActiveRates,
  getRatesAsOf,
  isUsingBundledRates,
  BUNDLED_RATES_AS_OF,
} from './currencies';

test('conversion falls back to the bundled table before any fetch', () => {
  expect(isUsingBundledRates()).toBe(true);
  expect(getRatesAsOf()).toBe(BUNDLED_RATES_AS_OF);
  // USD → USD is identity whatever the table says.
  expect(convertCurrency(100, 'USD', 'USD')).toBe(100);
});

test('live rates replace the bundled ones once installed', () => {
  setActiveRates({ USD: 1, EUR: 0.5, MAD: 10 }, '2026-08-18');

  expect(isUsingBundledRates()).toBe(false);
  expect(getRatesAsOf()).toBe('2026-08-18');
  // 100 USD at 0.5 EUR/USD.
  expect(convertCurrency(100, 'USD', 'EUR')).toBe(50);
  // 10 MAD → 1 USD → 0.5 EUR.
  expect(convertCurrency(10, 'MAD', 'EUR')).toBe(0.5);
});

test('a currency missing from the live table falls back to the bundled rate', () => {
  setActiveRates({ USD: 1, EUR: 0.5 }, '2026-08-18');
  // JPY is absent from the live table above but present in the bundled one,
  // so the conversion still produces something rather than silently returning
  // the input unchanged.
  expect(convertCurrency(100, 'USD', 'JPY')).toBeGreaterThan(100);
});

test('an entirely unknown currency returns the amount unchanged', () => {
  expect(convertCurrency(100, 'USD', 'NOTACURRENCY')).toBe(100);
});

test('rates matching is case-insensitive', () => {
  setActiveRates({ USD: 1, EUR: 0.5 }, '2026-08-18');
  expect(convertCurrency(100, 'usd', 'eur')).toBe(50);
});
