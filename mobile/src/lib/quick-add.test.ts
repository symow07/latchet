import { test, expect } from 'bun:test';
import { parseQuickAdd } from './quick-add';

test('amount then note', () => {
  expect(parseQuickAdd('12.50 coffee')).toEqual({ amount: 12.5, type: 'Expense', note: 'coffee' });
});

test('note then amount', () => {
  expect(parseQuickAdd('coffee 4')).toEqual({ amount: 4, type: 'Expense', note: 'coffee' });
});

test('a comma decimal is the same amount as a dot', () => {
  expect(parseQuickAdd('12,50 café')!.amount).toBe(12.5);
});

test('thousands separators are grouping, not decimals', () => {
  expect(parseQuickAdd('1,234.56 rent')!.amount).toBe(1234.56);
  expect(parseQuickAdd('1.234,56 loyer')!.amount).toBe(1234.56);
  // No two-digit tail: every separator is grouping.
  expect(parseQuickAdd('1.234 rent')!.amount).toBe(1234);
});

test('a currency symbol does not end up in the note', () => {
  expect(parseQuickAdd('$40 groceries')).toEqual({ amount: 40, type: 'Expense', note: 'groceries' });
  expect(parseQuickAdd('40€ courses')!.note).toBe('courses');
});

test('income is recognised from the words people actually type', () => {
  expect(parseQuickAdd('got paid 2000')!.type).toBe('Income');
  expect(parseQuickAdd('refund 30 from amazon')!.type).toBe('Income');
  expect(parseQuickAdd('+ 500 side project')!.type).toBe('Income');
});

test('"paid" on its own is still an expense', () => {
  // "paid the plumber 80" is money going out.
  expect(parseQuickAdd('paid the plumber 80')!.type).toBe('Expense');
});

test('no amount means no transaction', () => {
  // A zero-value row is noise the user then has to find and delete.
  for (const junk of ['', '   ', 'coffee', 'lunch with sam', '$', '.']) {
    expect(parseQuickAdd(junk)).toBeNull();
  }
});

test('a negative is read as a magnitude', () => {
  expect(parseQuickAdd('-15 parking')!.amount).toBe(15);
});

test('only the first number is the amount', () => {
  const r = parseQuickAdd('20 uber to 5th avenue')!;
  expect(r.amount).toBe(20);
  expect(r.note).toBe('uber to 5th avenue');
});

test('an amount with no note is still a transaction', () => {
  expect(parseQuickAdd('9.99')).toEqual({ amount: 9.99, type: 'Expense', note: '' });
});

test('a long note is truncated rather than rejected', () => {
  expect(parseQuickAdd('5 ' + 'x'.repeat(400))!.note).toHaveLength(200);
});

test('a space-separated pair is not glued into one number', () => {
  // The number pattern allows the narrow spaces French uses for grouping, so
  // it must not also swallow an ordinary space between two separate figures.
  const r = parseQuickAdd('20 30')!;
  expect(r.amount).toBe(20);
  expect(r.note).toBe('30');
});

test('a French-grouped amount with a narrow space is one number', () => {
  expect(parseQuickAdd('1 234,56 loyer')!.amount).toBe(1234.56);
});
