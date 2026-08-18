import { test, expect } from 'bun:test';
import {
  planAccountUpserts,
  selectNewTransactions,
  recomputeBalance,
  netByAccount,
  deriveOpeningBalance,
  type CloudAccount,
  type CloudTransaction,
} from './sync-merge';

const account = (over: Partial<CloudAccount> = {}): CloudAccount => ({
  id: 'acc_server_1',
  name: 'Checking',
  type: 'checking',
  balance: 900,
  ...over,
});

const tx = (over: Partial<CloudTransaction> = {}): CloudTransaction => ({
  id: 'tx_server_1',
  amount: 100,
  category: 'Food',
  type: 'Expense',
  dateISO: '2026-08-01',
  accountId: 'acc_server_1',
  ...over,
});

test('planned accounts keep the server id', () => {
  const [planned] = planAccountUpserts([account()], []);
  expect(planned!.id).toBe('acc_server_1');
});

test('opening balance backs out the server-side transactions', () => {
  // Server says the account holds 900 after a 100 expense, so it opened at 1000.
  const [planned] = planAccountUpserts([account({ balance: 900 })], [tx()]);
  expect(planned!.openingBalance).toBe(1000);
});

test('recomputing reproduces the server balance exactly', () => {
  const cloudTxs = [tx(), tx({ id: 'tx_server_2', amount: 50 })];
  const [planned] = planAccountUpserts([account({ balance: 850 })], cloudTxs);
  expect(recomputeBalance(planned!.openingBalance, cloudTxs)).toBe(850);
});

test('a second pull selects no new transactions', () => {
  const cloudTxs = [tx(), tx({ id: 'tx_server_2' })];

  const firstPull = selectNewTransactions(cloudTxs, []);
  expect(firstPull.length).toBe(2);

  // After the first pull the device holds those ids — the exact step the old
  // implementation broke by minting its own ids and discarding the server's.
  const localIds = firstPull.map((t) => t.id);
  const secondPull = selectNewTransactions(cloudTxs, localIds);
  expect(secondPull.length).toBe(0);
});

test('logging in twice leaves the balance unchanged', () => {
  const cloudTxs = [tx(), tx({ id: 'tx_server_2', amount: 50 })];
  const cloudAccounts = [account({ balance: 850 })];

  const runPull = (localIds: string[]) => {
    const [planned] = planAccountUpserts(cloudAccounts, cloudTxs);
    const added = selectNewTransactions(cloudTxs, localIds);
    const held = [...localIds, ...added.map((t) => t.id)];
    const ledger = cloudTxs.filter((t) => held.includes(t.id));
    return { balance: recomputeBalance(planned!.openingBalance, ledger), held };
  };

  const first = runPull([]);
  const second = runPull(first.held);

  expect(first.balance).toBe(850);
  expect(second.balance).toBe(850);
  expect(second.held.length).toBe(2);
});

test('transactions this device alone knows about still count', () => {
  const cloudTxs = [tx()];
  const [planned] = planAccountUpserts([account({ balance: 900 })], cloudTxs);

  // 900 on the server, plus an unsynced local 25 expense.
  const localOnly = tx({ id: 'tx_local_1', amount: 25 });
  expect(recomputeBalance(planned!.openingBalance, [...cloudTxs, localOnly])).toBe(875);
});

test('income and expense move the balance in opposite directions', () => {
  const net = netByAccount([
    tx({ id: 'a', amount: 200, type: 'Income' }),
    tx({ id: 'b', amount: 75, type: 'Expense' }),
  ]);
  expect(net.get('acc_server_1')).toBe(125);
});

test('transactions with no account are ignored by the ledger', () => {
  expect(netByAccount([tx({ accountId: null })]).size).toBe(0);
});

test('deriveOpeningBalance is a plain subtraction', () => {
  expect(deriveOpeningBalance(500, -120)).toBe(620);
});
