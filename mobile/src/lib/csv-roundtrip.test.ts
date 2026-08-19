import { test, expect } from 'bun:test';
import { buildTransactionsCSV, type ExportableTransaction } from './csv-export';
import { parseCSV } from './import-parser';

const tx = (over: Partial<ExportableTransaction> = {}): ExportableTransaction => ({
  id: 'tx_1',
  amount: 42.5,
  category: 'Food',
  type: 'Expense',
  isImpulse: 0,
  note: 'Carrefour',
  dateISO: '2026-08-18',
  currency: 'EUR',
  ...over,
});

/** Export, then read straight back in. */
function roundTrip(txs: ExportableTransaction[]) {
  return parseCSV(buildTransactionsCSV(txs));
}

test('a category the user chose survives the round trip', () => {
  // Previously Category was written but ignored on import, so it was replaced
  // by a keyword guess from the description — silently discarding a correction
  // the user had made by hand.
  const [row] = roundTrip([tx({ category: 'Gym', note: 'PIZZA EXPRESS' })]);

  // "PIZZA" would autocategorise to Food; the stated category must win.
  expect(row!.suggestedCategory).toBe('Gym');
});

test('a custom category survives the round trip', () => {
  // Custom categories are a shipped feature, so this cannot be a fixed union.
  const [row] = roundTrip([tx({ category: 'Tagine ingredients' })]);
  expect(row!.suggestedCategory).toBe('Tagine ingredients');
});

test('the impulse flag survives, in both directions', () => {
  // Impulse was never exported at all, so it could not be recovered by any
  // means — a re-import silently re-guessed it from the description.
  const [impulsive] = roundTrip([tx({ isImpulse: 1, note: 'Something dull' })]);
  expect(impulsive!.isImpulse).toBe(true);

  const [deliberate] = roundTrip([tx({ isImpulse: 0, note: 'impulse buy sale deal' })]);
  // The description would otherwise trip the impulse heuristic.
  expect(deliberate!.isImpulse).toBe(false);
});

test('currency survives the round trip', () => {
  const [row] = roundTrip([tx({ currency: 'MAD' })]);
  expect(row!.currency).toBe('MAD');
});

test('amount, date, description and direction survive', () => {
  const [expense] = roundTrip([tx({ amount: 1234.56, type: 'Expense' })]);
  expect(expense!.amount).toBe(1234.56);
  expect(expense!.date).toBe('2026-08-18');
  expect(expense!.description).toBe('Carrefour');
  expect(expense!.type).toBe('Expense');

  const [income] = roundTrip([tx({ amount: 2500, type: 'Income', note: 'Salary' })]);
  expect(income!.type).toBe('Income');
  expect(income!.amount).toBe(2500);
});

test('descriptions containing commas and quotes survive', () => {
  const [row] = roundTrip([tx({ note: 'Cafe "Le Coin", Rabat' })]);
  expect(row!.description).toBe('Cafe "Le Coin", Rabat');
});

test('a whole ledger round-trips unchanged', () => {
  const original: ExportableTransaction[] = [
    tx({ id: 'a', amount: 12.3, category: 'Food', type: 'Expense', isImpulse: 1, note: 'Coffee' }),
    tx({ id: 'b', amount: 2500, category: 'Salary', type: 'Income', isImpulse: 0, note: 'Payday' }),
    tx({ id: 'c', amount: 89.9, category: 'Transport', type: 'Expense', isImpulse: 0, note: 'SNCF' }),
  ];

  const reimported = roundTrip(original);
  expect(reimported).toHaveLength(3);

  const shape = (t: {
    amount: number;
    category: string;
    type: string;
    isImpulse: boolean;
    description: string;
    date: string;
    currency?: string;
  }) => t;

  const before = original.map((t) =>
    shape({
      amount: t.amount,
      category: t.category,
      type: t.type,
      isImpulse: Boolean(t.isImpulse),
      description: t.note ?? '',
      date: t.dateISO,
      currency: t.currency,
    })
  );
  const after = reimported.map((r) =>
    shape({
      amount: r.amount,
      category: r.suggestedCategory,
      type: r.type,
      isImpulse: r.isImpulse,
      description: r.description,
      date: r.date,
      currency: r.currency,
    })
  );

  expect(after).toEqual(before);
});

test('a plain bank CSV without the extra columns still imports', () => {
  // The extra columns must not become a requirement.
  const bank = `Date,Description,Amount
03/15/2026,WHOLE FOODS,-84.32`;
  const [row] = parseCSV(bank);

  expect(row!.amount).toBe(84.32);
  expect(row!.type).toBe('Expense');
  // Falls back to guessing, which is correct when the file says nothing.
  expect(row!.suggestedCategory).toBe('Food');
});
