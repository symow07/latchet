/**
 * Pure merge logic for cloud sync. Dependency-free so it can be unit-tested
 * without expo-sqlite or the network layer.
 *
 * The rule this module encodes: a pulled row keeps the *server's* id, and an
 * account's balance is derived (openingBalance + ledger) rather than adjusted
 * incrementally. Together those make a pull idempotent — the property the
 * previous implementation lacked, which duplicated every account and
 * transaction on each login and re-debited the balance each time.
 */

export interface CloudAccount {
  id: string;
  name: string;
  type: string;
  balance?: number;
  currency?: string;
  color?: string;
  icon?: string;
  isDefault?: boolean;
  createdAt?: string;
}

export interface CloudTransaction {
  id: string;
  amount: number;
  category: string;
  type: 'Expense' | 'Income';
  isImpulse?: boolean | number;
  note?: string | null;
  dateISO: string;
  accountId?: string | null;
  currency?: string;
  createdAt?: string;
}

/** Signed effect of a transaction on its account. */
export function signedAmount(tx: Pick<CloudTransaction, 'amount' | 'type'>): number {
  return tx.type === 'Income' ? tx.amount : -tx.amount;
}

/** Net effect of a set of transactions, grouped by account id. */
export function netByAccount(transactions: CloudTransaction[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.accountId) continue;
    net.set(tx.accountId, (net.get(tx.accountId) ?? 0) + signedAmount(tx));
  }
  return net;
}

/**
 * The server's `balance` already reflects the server's transactions. Since a
 * local recompute will re-add those same transactions, back them out first.
 */
export function deriveOpeningBalance(
  serverBalance: number,
  cloudNetForAccount: number
): number {
  return serverBalance - cloudNetForAccount;
}

export interface AccountUpsert extends CloudAccount {
  openingBalance: number;
}

/** Accounts to write locally, each under the server's id. */
export function planAccountUpserts(
  cloudAccounts: CloudAccount[],
  cloudTransactions: CloudTransaction[]
): AccountUpsert[] {
  const net = netByAccount(cloudTransactions);
  return cloudAccounts.map((acc) => ({
    ...acc,
    openingBalance: deriveOpeningBalance(acc.balance ?? 0, net.get(acc.id) ?? 0),
  }));
}

/** Cloud transactions this device does not already hold, keyed on server id. */
export function selectNewTransactions(
  cloudTransactions: CloudTransaction[],
  localTransactionIds: Iterable<string>
): CloudTransaction[] {
  const known = new Set(localTransactionIds);
  return cloudTransactions.filter((tx) => !known.has(tx.id));
}

/** balance = openingBalance + net of every transaction booked to the account. */
export function recomputeBalance(
  openingBalance: number,
  transactionsForAccount: Pick<CloudTransaction, 'amount' | 'type'>[]
): number {
  return transactionsForAccount.reduce((sum, tx) => sum + signedAmount(tx), openingBalance);
}
