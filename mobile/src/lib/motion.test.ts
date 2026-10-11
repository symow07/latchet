import { test, expect, describe, it } from 'bun:test';
import {
  easeOutExpo, countAt, countDuration,
  currencyParts, formatWithParts, splitAmount,
  amountScale,
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

test('a count-up takes the identity\'s 280 ms, under the 300 ms ceiling, at any size', () => {
  expect(countDuration(0)).toBe(0);
  for (const n of [1, 50, 4321, 1e9, -12]) {
    expect(countDuration(n)).toBe(280);
    expect(countDuration(n)).toBeLessThan(300);
  }
});

test('a negative target still gets a real duration', () => {
  expect(countDuration(-4321)).toBeGreaterThan(0);
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

describe('splitAmount — the §3 number rules', () => {
  const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  const eur = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
  const jpy = (n: number) =>
    new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(n);

  it('splits a dollar amount into symbol, whole and fraction', () => {
    const out = splitAmount(4230, currencyParts(usd), false);
    expect(out).toEqual({ sign: '', prefix: '$', whole: '4,230', fraction: '.00', suffix: '' });
  });

  it('keeps the symbol trailing where the locale puts it there', () => {
    const out = splitAmount(1234.56, currencyParts(eur), false);
    expect(out.prefix).toBe('');
    expect(out.suffix).toBe('€');
    // French groups with a narrow no-break space and decimals with a comma.
    expect(out.fraction.startsWith(',')).toBe(true);
  });

  it('renders a zero-decimal currency with no fraction at all', () => {
    const out = splitAmount(1234, currencyParts(jpy), false);
    expect(out.fraction).toBe('');
    expect(out.whole).toBe('1,234');
  });

  it('always signs a signed amount, and uses a real minus sign', () => {
    const parts = currencyParts(usd);
    expect(splitAmount(-23.12, parts, true).sign).toBe('−');
    expect(splitAmount(1200, parts, true).sign).toBe('+');
    // A hyphen sits short and high against tabular digits.
    expect(splitAmount(-23.12, parts, true).sign).not.toBe('-');
  });

  it('signs a negative even when the caller did not ask for signs', () => {
    // Losing the minus would turn a debt into a credit.
    expect(splitAmount(-5, currencyParts(usd), false).sign).toBe('−');
  });

  it('does not sign a positive unless asked', () => {
    expect(splitAmount(5, currencyParts(usd), false).sign).toBe('');
  });

  it('groups only above a thousand, and never inside the fraction', () => {
    const parts = currencyParts(usd);
    expect(splitAmount(999.99, parts, false).whole).toBe('999');
    expect(splitAmount(1000, parts, false).whole).toBe('1,000');
    expect(splitAmount(1234567.89, parts, false)).toMatchObject({
      whole: '1,234,567',
      fraction: '.89',
    });
  });

  it('survives the seven significant digits §7 requires of the balance card', () => {
    expect(splitAmount(9999999.99, currencyParts(usd), false).whole).toBe('9,999,999');
  });

  it('renders zero without a sign or a stray separator', () => {
    expect(splitAmount(0, currencyParts(usd), false)).toEqual({
      sign: '', prefix: '$', whole: '0', fraction: '.00', suffix: '',
    });
  });
});

// ── Fitting a long amount ───────────────────────────────────────────────────

describe('amountScale', () => {
  it('leaves an amount that already fits alone', () => {
    expect(amountScale(8, 11)).toBe(1);
    expect(amountScale(11, 11)).toBe(1);
  });

  it('shrinks in proportion to the overflow', () => {
    // The case from the screenshot: "−CN¥77,777,884.00" is 17 glyphs in a
    // budget of 11, and rendered with its decimals clipped by the card.
    expect(amountScale(17, 11)).toBeCloseTo(11 / 17, 5);
    expect(amountScale(22, 11)).toBeCloseTo(0.55, 5);
  });

  it('never shrinks past the floor', () => {
    // A hero number at 0.4 of its size is no longer the hero.
    expect(amountScale(400, 11)).toBe(0.55);
  });

  it('does not divide by zero on an absent budget', () => {
    expect(amountScale(20, 0)).toBe(1);
  });
});
