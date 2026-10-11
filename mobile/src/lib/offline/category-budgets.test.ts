import { describe, expect, test } from 'bun:test';
import { budgetLines, parseBudgetLimit } from './category-budgets';

describe('phase4 screens', () => {
  test('a category budget is keyed by its category: one line each, and a budget whose category is gone is still listed', () => {
    const categories = [{ name: 'Food' }, { name: 'Transport' }, { name: 'Pets' }];
    const budgets = [
      { category: 'Pets', amount: 40 },
      { category: 'Food', amount: 300 },
      // A custom category since renamed (a delete and a create): its budget
      // is keyed by the old name.
      { category: 'Doggo', amount: 25 },
    ];
    expect(budgetLines(categories, budgets)).toEqual([
      { name: 'Food', category: { name: 'Food' }, budget: { category: 'Food', amount: 300 } },
      { name: 'Transport', category: { name: 'Transport' }, budget: null },
      { name: 'Pets', category: { name: 'Pets' }, budget: { category: 'Pets', amount: 40 } },
      { name: 'Doggo', category: null, budget: { category: 'Doggo', amount: 25 } },
    ]);
  });
});

test('a typed limit is a positive amount the server keeps', () => {
  expect(parseBudgetLimit('250')).toBe(250);
  expect(parseBudgetLimit('12.5')).toBe(12.5);
  expect(parseBudgetLimit('0')).toBeNull();
  expect(parseBudgetLimit('')).toBeNull();
  expect(parseBudgetLimit('-3')).toBeNull();
  expect(parseBudgetLimit('99999999')).toBeNull();
});
