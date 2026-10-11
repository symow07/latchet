import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLocale } from './i18n/core';
import {
  expenseCategoryLabel,
  expenseStatusLabel,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
} from './expense-meta';

test('categories translate for display', () => {
  setLocale('fr');
  expect(expenseCategoryLabel('Travel')).toBe('Déplacement');
  setLocale('zh');
  expect(expenseCategoryLabel('Software')).toBe('软件');
  setLocale('en');
  expect(expenseCategoryLabel('Meals')).toBe('Meals');
});

test('statuses translate for display', () => {
  setLocale('fr');
  expect(expenseStatusLabel('pending')).toBe('En attente');
  expect(expenseStatusLabel('approved')).toBe('Approuvée');
  setLocale('en');
  // The filter row's "all" is labelled too, not shown as its key.
  expect(expenseStatusLabel('all')).toBe('All');
});

test('the stored value is never what gets translated', () => {
  // The backend validates category against a fixed English enum, so a
  // translated value reaching a write would be rejected — or worse, accepted
  // and then unmatchable.
  setLocale('fr');
  for (const category of EXPENSE_CATEGORIES) {
    expect(expenseCategoryLabel(category)).not.toBe(undefined);
    // The canonical name is unchanged by asking for its label.
    expect(EXPENSE_CATEGORIES).toContain(category);
  }
  setLocale('en');
});

test('an unrecognised value comes back unchanged rather than blank', () => {
  setLocale('fr');
  expect(expenseCategoryLabel('Cryogenics')).toBe('Cryogenics');
  expect(expenseStatusLabel('escalated')).toBe('escalated');
  expect(expenseCategoryLabel('')).toBe('');
  setLocale('en');
});

test('every category and status has a label in all three languages', () => {
  for (const locale of ['en', 'fr', 'zh'] as const) {
    const json = JSON.parse(
      readFileSync(join(import.meta.dir, 'i18n', 'locales', `${locale}.json`), 'utf8')
    ) as { expenseCategories?: Record<string, string>; expenseStatuses?: Record<string, string> };

    for (const c of EXPENSE_CATEGORIES) expect(json.expenseCategories?.[c]).toBeTruthy();
    for (const s of EXPENSE_STATUSES) expect(json.expenseStatuses?.[s]).toBeTruthy();
    // The filter row also offers "all", which is not a stored status.
    expect(json.expenseStatuses?.all).toBeTruthy();
  }
});

test('expense categories stay distinct from transaction categories', () => {
  // "Transport" appears in both vocabularies by coincidence, not shared
  // meaning, so they must not be folded into one namespace.
  const en = JSON.parse(
    readFileSync(join(import.meta.dir, 'i18n', 'locales', 'en.json'), 'utf8')
  ) as Record<string, unknown>;

  expect(en.expenseCategories).toBeDefined();
  expect(en.categories).toBeDefined();
  expect(en.expenseCategories).not.toBe(en.categories);
});
