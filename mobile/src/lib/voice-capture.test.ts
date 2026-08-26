import { test, expect } from 'bun:test';
import {
  toReviewRows,
  toTransactionInputs,
  reviewTotals,
  type VoiceRow,
} from './voice-capture';

const row = (over: Partial<VoiceRow> = {}): VoiceRow => ({
  dateISO: '2026-08-26',
  amount: 12,
  type: 'Expense',
  category: 'Food',
  note: 'lunch',
  ...over,
});

test('everything heard is kept by default', () => {
  // The user is reviewing, not re-entering. Defaulting to excluded would make
  // them tick four boxes to accept what they just said out loud.
  const rows = toReviewRows([row(), row({ amount: 40 })]);
  expect(rows.every((r) => r.include)).toBe(true);
});

test('rows keep a stable key so the list does not reorder mid-edit', () => {
  const rows = toReviewRows([row(), row({ amount: 40 }), row({ amount: 40 })]);
  expect(new Set(rows.map((r) => r.key)).size).toBe(3);
});

test('only the rows the user kept are written', () => {
  const rows = toReviewRows([row(), row({ amount: 40, note: 'petrol' })]);
  rows[1]!.include = false;
  const inputs = toTransactionInputs(rows);
  expect(inputs).toHaveLength(1);
  expect(inputs[0]!.note).toBe('lunch');
});

test('a row edited down to zero is not written', () => {
  // The review sheet lets the amount be cleared; an empty field must not
  // become a zero-value transaction.
  const rows = toReviewRows([row({ amount: 0 })]);
  expect(toTransactionInputs(rows)).toHaveLength(0);
});

test('spoken transactions are never marked impulse', () => {
  // detectImpulse infers from keywords in a typed description. A spoken
  // sentence is not that, and guessing would skew the one metric the
  // dashboard reports about self-control.
  const inputs = toTransactionInputs(toReviewRows([row({ note: 'impulse buy shopping spree' })]));
  expect(inputs[0]!.isImpulse).toBe(false);
});

test('income and expense are totalled apart', () => {
  const rows = toReviewRows([
    row({ amount: 12 }),
    row({ amount: 40 }),
    row({ amount: 2000, type: 'Income', category: 'Salary' }),
  ]);
  expect(reviewTotals(rows)).toEqual({ expense: 52, income: 2000, count: 3 });
});

test('excluded rows drop out of the totals as well as the write', () => {
  const rows = toReviewRows([row({ amount: 12 }), row({ amount: 40 })]);
  rows[0]!.include = false;
  expect(reviewTotals(rows)).toEqual({ expense: 40, income: 0, count: 1 });
});

test('an empty extraction is a legitimate result, not a crash', () => {
  // Someone can talk for a minute without naming a figure.
  expect(toReviewRows([])).toEqual([]);
  expect(toTransactionInputs([])).toEqual([]);
  expect(reviewTotals([])).toEqual({ expense: 0, income: 0, count: 0 });
});

test('the date the model resolved is carried through to the write', () => {
  const inputs = toTransactionInputs(toReviewRows([row({ dateISO: '2026-08-24' })]));
  expect(inputs[0]!.dateISO).toBe('2026-08-24');
});
