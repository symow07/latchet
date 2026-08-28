import { test, expect } from 'bun:test';
import {
  easeOutExpo, countAt, countDuration, BREATH_MIN, BREATH_MAX,
  currencyParts, formatWithParts,
} from './motion';

test('the curve starts at zero and lands on one', () => {
  expect(easeOutExpo(0)).toBe(0);
  expect(easeOutExpo(1)).toBe(1);
});

test('it is clamped outside the unit interval', () => {
  // A frame can arrive late; the number must not overshoot its own total.
  expect(easeOutExpo(-3)).toBe(0);
  expect(easeOutExpo(4)).toBe(1);
});

test('it eases OUT — most of the distance is covered early', () => {
  // The point of the curve: it arrives fast and settles, rather than
  // accelerating into place like an ease-in would.
  expect(easeOutExpo(0.25)).toBeGreaterThan(0.8);
  expect(easeOutExpo(0.5)).toBeGreaterThan(0.96);
});

test('it never runs backwards', () => {
  let previous = -1;
  for (let t = 0; t <= 1; t += 0.02) {
    const v = easeOutExpo(t);
    expect(v).toBeGreaterThanOrEqual(previous);
    previous = v;
  }
});

test('a counting number ends exactly on its target', () => {
  // Landing on 2431.19 instead of 2431.20 would be a wrong balance, briefly.
  expect(countAt(2431.2, 9999, 800)).toBe(2431.2);
  expect(countAt(2431.2, 800, 800)).toBe(2431.2);
});

test('counting handles zero, negatives and a zero duration', () => {
  expect(countAt(0, 100, 800)).toBe(0);
  expect(countAt(-500, 800, 800)).toBe(-500);
  expect(countAt(42, 0, 0)).toBe(42);
});

test('duration scales with magnitude but stays bounded', () => {
  // A fixed duration makes 12 feel sluggish and 4,000,000 feel rushed.
  expect(countDuration(0)).toBe(0);
  expect(countDuration(12)).toBeLessThan(countDuration(120000));
  expect(countDuration(999999999)).toBeLessThanOrEqual(1100);
  // Nobody should wait more than about a second to read their own balance.
  for (const n of [1, 50, 4321, 1e9]) expect(countDuration(n)).toBeLessThanOrEqual(1100);
});

test('a negative target still gets a real duration', () => {
  expect(countDuration(-4321)).toBeGreaterThan(0);
});

test('the breath is wide enough to see and narrow enough not to flash', () => {
  // Measured, not guessed: at 0.72 the peak pixel difference across half a
  // cycle was 4/255 — real in the buffer and invisible to a person.
  expect(BREATH_MAX - BREATH_MIN).toBeGreaterThan(0.35);
  expect(BREATH_MAX - BREATH_MIN).toBeLessThan(0.7);
  expect(BREATH_MIN).toBeGreaterThan(0.2);
  expect(BREATH_MAX).toBeLessThanOrEqual(1);
});

// ── Locale-safe formatting ───────────────────────────────────────────────────


const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const eurFr = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const mad = (n: number) =>
  new Intl.NumberFormat('ar-MA', { style: 'currency', currency: 'MAD' }).format(n);

test('the counted string matches Intl exactly, in every locale the app ships', () => {
  // The whole point: a counting number must not quietly become US-formatted
  // for a French or Moroccan user on its way to the same final value.
  for (const format of [usd, eurFr, mad]) {
    const parts = currencyParts(format);
    for (const amount of [0, 5, 42.5, 1234.56, 999999.99]) {
      expect(formatWithParts(amount, parts)).toBe(format(amount));
    }
  }
});

test('negative amounts keep their sign', () => {
  const parts = currencyParts(usd);
  expect(formatWithParts(-1234.56, parts)).toContain('1,234.56');
  expect(formatWithParts(-1234.56, parts).startsWith('-')).toBe(true);
});

test('grouping appears only above a thousand', () => {
  const parts = currencyParts(usd);
  expect(formatWithParts(999, parts)).toBe(usd(999));
  expect(formatWithParts(1000, parts)).toBe(usd(1000));
});

test('a formatter with no decimals is honoured', () => {
  const jpy = (n: number) =>
    new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(n);
  const parts = currencyParts(jpy);
  expect(parts.decimals).toBe(0);
  expect(formatWithParts(1234, parts)).toBe(jpy(1234));
});

test('a nonsense formatter degrades instead of throwing', () => {
  const parts = currencyParts(() => 'no digits here');
  expect(() => formatWithParts(12.3, parts)).not.toThrow();
});

test('grouping and decimals are told apart in currencies that have no decimals', () => {
  // The failure this replaced: JPY prints 1234.56 as "￥1,235", and a single
  // probe reads that grouping comma as a decimal point — reporting three
  // decimal places and then formatting every yen figure wrongly.
  const cases: [string, string, number][] = [
    ['ja-JP', 'JPY', 0],
    ['en-US', 'USD', 2],
    ['fr-FR', 'EUR', 2],
    ['ar-MA', 'MAD', 2],
  ];
  for (const [locale, currency, expected] of cases) {
    const f = (n: number) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
    const parts = currencyParts(f);
    expect(parts.decimals).toBe(expected);
    expect(parts.group).not.toBe(parts.decimal);
    for (const amount of [0, 7, 1234, 1234567.89]) {
      expect(formatWithParts(amount, parts)).toBe(f(amount));
    }
  }
});
