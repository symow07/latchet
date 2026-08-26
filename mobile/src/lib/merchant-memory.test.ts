import { test, expect } from 'bun:test';
import {
  buildMerchantMemory,
  suggestCategory,
  merchantKeys,
  merchantTokens,
} from './merchant-memory';

const tx = (note: string, category: string, dateISO = '2026-08-01') => ({
  note,
  category,
  dateISO,
});

test('the merchant survives the noise a bank wraps it in', () => {
  expect(merchantTokens('CARREFOUR MARKET 4412 CASABLANCA')).toEqual([
    'carrefour',
    'market',
    'casablanca',
  ]);
  expect(merchantTokens('POS PURCHASE VISA CARD 1234 MARJANE')).toEqual(['marjane']);
});

test('non-Latin merchant names are kept, not stripped', () => {
  // The markets this is for do not write receipts in ASCII. Dropping these
  // would leave exactly the users the keyword table already fails.
  expect(merchantTokens('美团外卖 12.50')).toEqual(['美团外卖']);
  expect(merchantTokens('مقهى الصباح')).toEqual(['مقهى', 'الصباح']);
});

test('a description contributes every prefix, longest first', () => {
  expect(merchantKeys('Uber Eats lunch')).toEqual(['uber eats lunch', 'uber eats', 'uber']);
  expect(merchantKeys('Marjane')).toEqual(['marjane']);
});

test('one categorisation is enough to suggest the next', () => {
  const memory = buildMerchantMemory([tx('Carrefour Casablanca', 'Food')]);
  expect(suggestCategory('CARREFOUR MARKET 4412', memory)).toBe('Food');
});

test('a merchant the keyword table has never heard of is learned', () => {
  // autoCategorize answers "Other" for all of these. That is the gap.
  const memory = buildMerchantMemory([
    tx('Marjane', 'Food'),
    tx('Afriquia', 'Transport'),
    tx('美团外卖', 'Food'),
  ]);
  expect(suggestCategory('MARJANE RABAT', memory)).toBe('Food');
  expect(suggestCategory('AFRIQUIA STATION 22', memory)).toBe('Transport');
  expect(suggestCategory('美团外卖', memory)).toBe('Food');
});

test('the longer merchant wins, so Uber Eats is not Transport', () => {
  // The failure this prevents: one token swallowing another, and the user
  // having to undo the same wrong suggestion every week.
  const memory = buildMerchantMemory([
    tx('Uber trip downtown', 'Transport'),
    tx('Uber trip airport', 'Transport'),
    tx('Uber Eats dinner', 'Food'),
    tx('Uber Eats lunch', 'Food'),
  ]);
  expect(suggestCategory('Uber Eats burrito', memory)).toBe('Food');
  expect(suggestCategory('Uber trip home', memory)).toBe('Transport');
});

test('an inconsistent history suggests nothing rather than guessing', () => {
  // Six to five is not a decision. A blank field costs one tap; a confident
  // wrong answer costs trust in every later suggestion.
  const memory = buildMerchantMemory([
    ...Array.from({ length: 6 }, () => tx('Carrefour', 'Food')),
    ...Array.from({ length: 5 }, () => tx('Carrefour', 'Shopping')),
  ]);
  expect(suggestCategory('Carrefour', memory)).toBeNull();
});

test('a clear majority still suggests despite the odd exception', () => {
  const memory = buildMerchantMemory([
    ...Array.from({ length: 9 }, () => tx('Carrefour', 'Food')),
    tx('Carrefour', 'Shopping'),
  ]);
  expect(suggestCategory('Carrefour', memory)).toBe('Food');
});

test('a tie goes to the more recent choice', () => {
  const memory = buildMerchantMemory([
    tx('Netflix', 'Entertainment', '2026-01-01'),
    tx('Netflix', 'Subscriptions', '2026-08-01'),
  ]);
  expect(suggestCategory('Netflix', memory)).toBe('Subscriptions');
});

test('rows left on the fallback teach nothing', () => {
  // "Other" usually means the user never chose. Counting it would train the
  // memory to suggest the absence of a decision.
  const memory = buildMerchantMemory([
    tx('Random Shop', 'Other'),
    tx('Random Shop', 'Other'),
  ]);
  expect(suggestCategory('Random Shop', memory)).toBeNull();
});

test('an unknown merchant suggests nothing', () => {
  const memory = buildMerchantMemory([tx('Carrefour', 'Food')]);
  expect(suggestCategory('Some Place Never Seen', memory)).toBeNull();
  expect(suggestCategory('', memory)).toBeNull();
});

test('empty and malformed history does not throw', () => {
  expect(buildMerchantMemory([]).size).toBe(0);
  const memory = buildMerchantMemory([
    { note: null, category: 'Food', dateISO: null },
    { note: 'x', category: null, dateISO: '2026-01-01' },
    { note: '   ', category: 'Food', dateISO: '2026-01-01' },
  ]);
  expect(suggestCategory('anything', memory)).toBeNull();
});

test('a merchant seen under one category many times stays stable', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    tx('Spotify', 'Subscriptions', `2026-01-${String((i % 28) + 1).padStart(2, '0')}`),
  );
  const memory = buildMerchantMemory(many);
  expect(suggestCategory('SPOTIFY P12345', memory)).toBe('Subscriptions');
});

test('the boundary between "changed their mind" and "genuinely undecided"', () => {
  // Three observations split 2-1 is still thin enough that the newer choice
  // is the better guess. Four split 2-2 is not — that is real inconsistency,
  // and a suggestion there would be a coin flip the user keeps undoing.
  const thin = buildMerchantMemory([
    tx('Amazon', 'Shopping', '2026-01-01'),
    tx('Amazon', 'Shopping', '2026-01-02'),
    tx('Amazon', 'Subscriptions', '2026-08-01'),
  ]);
  expect(suggestCategory('Amazon', thin)).toBe('Shopping');

  const split = buildMerchantMemory([
    tx('Amazon', 'Shopping', '2026-01-01'),
    tx('Amazon', 'Shopping', '2026-01-02'),
    tx('Amazon', 'Subscriptions', '2026-08-01'),
    tx('Amazon', 'Subscriptions', '2026-08-02'),
  ]);
  expect(suggestCategory('Amazon', split)).toBeNull();
});
