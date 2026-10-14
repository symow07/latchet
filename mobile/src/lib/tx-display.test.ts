import { expect, test } from 'bun:test';
import { t } from './i18n/core';
import { accountTypeLabel, isDebtAccount, signedAccountBalance } from './tx-display';

test('account balance: a card and a loan are what is owed, so they count against the total', () => {
  expect(isDebtAccount('credit')).toBe(true);
  expect(isDebtAccount('loan')).toBe(true);
  for (const type of ['cash', 'checking', 'savings', 'investment', 'other']) expect(isDebtAccount(type)).toBe(false);

  // A linked student loan of 25,000 is 25,000 owed, not 25,000 to spend.
  const accounts = [
    { type: 'checking', balance: 1200 },
    { type: 'credit', balance: 300 },
    { type: 'loan', balance: 25000 },
  ];
  expect(accounts.map(signedAccountBalance)).toEqual([1200, -300, -25000]);
  expect(accounts.reduce((sum, a) => sum + signedAccountBalance(a), 0)).toBe(-24100);
});

test('account balance: every stored type has a label, a loan included', () => {
  expect(accountTypeLabel('loan')).toBe(t('accountTypes.loan'));
  expect(accountTypeLabel('loan')).not.toBe('loan');
  expect(accountTypeLabel('credit')).toBe(t('accountTypes.creditCard'));
  // Something unknown shows as stored rather than as a missing key.
  expect(accountTypeLabel('brokerage')).toBe('brokerage');
});
