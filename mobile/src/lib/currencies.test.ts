import { test, expect } from 'bun:test';
import {
  convertCurrency,
  setActiveRates,
  getRatesAsOf,
  isUsingBundledRates,
  formatCurrencyAmount,
  getCurrencyByCode,
  CURRENCIES,
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

// ── The widened list ─────────────────────────────────────────────────────────
// Most currencies now ship with no bundled rate and depend on the live table.
// The risk that buys is a silent NaN in money arithmetic, so it is pinned here.

test('every currency has a code, a name and a symbol', () => {
  for (const c of CURRENCIES) {
    expect(c.code).toMatch(/^[A-Z]{3}$/);
    expect(c.name.length).toBeGreaterThan(0);
    expect(c.symbol.length).toBeGreaterThan(0);
  }
});

test('codes are unique', () => {
  const codes = CURRENCIES.map((c) => c.code);
  expect(new Set(codes).size).toBe(codes.length);
});

test('a currency with no bundled rate returns the amount unchanged offline', () => {
  // Not NaN, and not a silently invented figure. AFN is one of the 93 that
  // exist only so they can be selected.
  const afn = getCurrencyByCode('AFN');
  expect(afn).toBeDefined();
  expect(afn!.rate).toBeUndefined();
  setActiveRates({}, '2026-01-01');
  expect(convertCurrency(100, 'USD', 'AFN')).toBe(100);
  expect(Number.isNaN(convertCurrency(100, 'USD', 'AFN'))).toBe(false);
});

test('a live rate is used for a currency that has no bundled one', () => {
  setActiveRates({ USD: 1, AFN: 70 }, '2026-01-01');
  expect(convertCurrency(1, 'USD', 'AFN')).toBeCloseTo(70, 6);
});

test('minor units come from the entry, including 3-decimal currencies', () => {
  // The list this replaced knew only about zero-decimal currencies, so a
  // Bahraini fils rendered as if it were a cent.
  expect(getCurrencyByCode('BHD')!.decimals).toBe(3);
  expect(formatCurrencyAmount(1.234, 'BHD')).toContain('1.234');
  expect(formatCurrencyAmount(1.4, 'JPY')).toContain('1');
  expect(formatCurrencyAmount(1.4, 'JPY')).not.toContain('.');
  expect(formatCurrencyAmount(1.5, 'USD')).toContain('1.50');
});

test('the popular shortlist still resolves against the widened list', () => {
  for (const code of ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'CAD', 'AUD', 'AED', 'SAR']) {
    expect(getCurrencyByCode(code)).toBeDefined();
  }
});
