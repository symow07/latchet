import { test, expect } from 'bun:test';
import { buildBusinessContext, businessContextIsEmpty, businessAdvisorPersona } from './business-advisor';

const facts = {
  name: 'Acme Ltd',
  memberCount: 4,
  currency: '$',
  monthLabel: 'August 2026',
  budget: { totalMonthly: 5000, byCategory: { Travel: 1000, Software: 500, Meals: 0 } },
  spending: { total: 3200, approved: 2800, byCategory: { Travel: 1200, Software: 400 } },
  payroll: { totalPayroll: 12000, paidTotal: 9000, unpaidTotal: 3000 },
  pendingExpenseCount: 3,
};

test('an empty or absent business contributes nothing', () => {
  expect(buildBusinessContext(null)).toBe('');
  expect(buildBusinessContext(undefined)).toBe('');
  expect(buildBusinessContext({})).toBe('');
  expect(businessContextIsEmpty({})).toBe(true);
});

test('a company with figures produces grounded context', () => {
  const out = buildBusinessContext(facts);
  expect(out).toContain('Acme Ltd');
  expect(out).toContain('Team size: 4');
  expect(out).toContain('$5000.00');
  expect(out).toContain('August 2026');
});

test('zero-valued categories are omitted rather than listed as noise', () => {
  const out = buildBusinessContext(facts);
  expect(out).toContain('Travel $1000.00');
  expect(out).not.toContain('Meals');
});

test('a zero budget is not announced as a budget', () => {
  // "Monthly budget: $0.00" reads as a real constraint and is not one.
  const out = buildBusinessContext({ ...facts, budget: { totalMonthly: 0, byCategory: {} } });
  expect(out).not.toContain('Monthly budget');
  expect(out).toContain('Acme Ltd');
});

test('an unpaid payroll balance is stated explicitly', () => {
  expect(buildBusinessContext(facts)).toContain('$3000.00 still unpaid');
});

test('no pending expenses means no pending line', () => {
  const out = buildBusinessContext({ ...facts, pendingExpenseCount: 0 });
  expect(out).not.toContain('awaiting review');
});

test('the currency is honoured and bounded', () => {
  const out = buildBusinessContext({ ...facts, currency: 'MAD' });
  expect(out).toContain('MAD5000.00');
  // A hostile or malformed currency cannot smuggle a paragraph into the prompt.
  const long = buildBusinessContext({ ...facts, currency: 'X'.repeat(500) });
  expect(long).toContain('XXX5000.00');
});

test('the persona does not restate the safety rules', () => {
  // Those are prepended server-side. Repeating them here would imply this half
  // is what enforces them, which it is not.
  const p = businessAdvisorPersona('Reply in English.');
  expect(p).not.toContain('HARD CONSTRAINTS');
  expect(p).toContain('Reply in English.');
  expect(p).toContain('small business');
});

test('the persona tells the model to name a missing figure rather than invent one', () => {
  expect(businessAdvisorPersona('')).toContain('say which one rather than estimating');
});
