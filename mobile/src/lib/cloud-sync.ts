/**
 * Cloud sync layer — syncs local SQLite data to/from the backend.
 * All operations are best-effort: local data is always the source of truth.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { api } from './api/api';
import {
  getTransactions,
  getAccounts,
  getSettings,
  createAccountWithId,
  addTransactionWithId,
  recomputeAccountBalances,
  updateSettings,
  onLocalMutation,
} from './db';
import {
  planAccountUpserts,
  selectNewTransactions,
  type CloudAccount,
  type CloudTransaction,
} from './sync-merge';

export interface SyncResult {
  success: boolean;
  error?: string;
}

/**
 * Set while a pull is applying server rows. Local writes made by the pull must
 * not schedule a push — that would bounce the same data straight back up.
 */
let isPulling = false;

/**
 * SQLite has no boolean type, so local rows carry 0/1 where the API's Zod
 * schemas expect real booleans. The bulk-sync endpoints *skip* rows that fail
 * to parse rather than erroring, so leaving these as integers would drop data
 * silently on every upload.
 */
const bool = (v: unknown): boolean => v === true || v === 1;

/** Push all local data to the cloud (best-effort; local stays authoritative) */
export async function pushLocalDataToCloud(): Promise<SyncResult> {
  try {
    const [transactions, accounts, settings] = await Promise.all([
      getTransactions(),
      getAccounts(),
      getSettings(),
    ]);

    await Promise.all([
      api.post('/api/transactions/sync', {
        transactions: transactions.map((t) => ({
          ...t,
          isImpulse: bool(t.isImpulse),
        })),
      }),
      api.post('/api/accounts/sync', {
        accounts: accounts.map((a) => ({ ...a, isDefault: bool(a.isDefault) })),
      }),
      api.put('/api/settings', {
        ...settings,
        showTimeCost: bool(settings?.showTimeCost),
      }),
    ]);

    return { success: true };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.warn('[CloudSync] pushLocalDataToCloud failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/** Fetch all transactions from the cloud, paginating until exhausted */
async function fetchAllCloudTransactions(): Promise<any[]> {
  const PAGE = 100;
  let offset = 0;
  const all: any[] = [];
  while (true) {
    const res = await api.get<{ data: any[]; pagination: { hasMore: boolean } }>(
      `/api/transactions?limit=${PAGE}&offset=${offset}`
    );
    const page = res?.data ?? [];
    all.push(...page);
    if (!res?.pagination?.hasMore || page.length === 0) break;
    offset += PAGE;
  }
  return all;
}

/**
 * Pull cloud data down and merge into local SQLite.
 *
 * Every row is written under the *server's* id. The previous implementation
 * routed through createAccount/addTransaction, which mint their own ids and
 * discard the server's — so nothing pulled was ever recognised as
 * already-present, and each login re-inserted the entire account and
 * re-applied every transaction's balance delta on top.
 */
export async function pullCloudDataToLocal(): Promise<SyncResult> {
  isPulling = true;
  try {
    const [cloudTransactions, cloudAccounts, cloudSettings] = await Promise.all([
      fetchAllCloudTransactions(),
      api.get<any[]>('/api/accounts'),
      api.get<any>('/api/settings'),
    ]);

    // Sync accounts first (transactions depend on them)
    const localAccounts = await getAccounts();
    const localById = new Map(localAccounts.map((a) => [a.id, a]));

    const planned = planAccountUpserts(
      (cloudAccounts ?? []) as CloudAccount[],
      (cloudTransactions ?? []) as CloudTransaction[]
    );

    for (const acc of planned) {
      const existing = localById.get(acc.id);
      await createAccountWithId(acc.id, {
        name: acc.name,
        type: acc.type,
        balance: acc.balance ?? 0,
        openingBalance: acc.openingBalance,
        currency: acc.currency ?? 'USD',
        color: acc.color ?? '#a855f7',
        icon: acc.icon ?? 'wallet',
        isDefault: acc.isDefault,
        createdAt: existing?.createdAt ?? acc.createdAt,
      }).catch(() => {});
    }

    // Sync transactions
    const localTxs = await getTransactions();
    const newTransactions = selectNewTransactions(
      (cloudTransactions ?? []) as CloudTransaction[],
      localTxs.map((t) => t.id)
    );

    for (const tx of newTransactions) {
      await addTransactionWithId(tx.id, {
        amount: tx.amount,
        category: tx.category,
        type: tx.type,
        isImpulse: Boolean(tx.isImpulse),
        note: tx.note ?? undefined,
        dateISO: tx.dateISO,
        accountId: tx.accountId ?? undefined,
        currency: tx.currency,
        createdAt: tx.createdAt,
      }).catch(() => {});
    }

    // One authoritative pass over the ledger instead of per-row deltas, so a
    // pull that runs twice cannot move any balance.
    await recomputeAccountBalances();

    // Sync settings
    if (cloudSettings) {
      await updateSettings(cloudSettings).catch(() => {});
    }

    return { success: true };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.warn('[CloudSync] pullCloudDataToLocal failed:', errorMessage);
    return { success: false, error: errorMessage };
  } finally {
    isPulling = false;
  }
}

const PUSH_DEBOUNCE_MS = 5_000;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalesce bursts of local writes into a single upload. Entering a category on
 * the add screen fires several mutations in a row; this uploads once.
 */
export function scheduleCloudPush(delayMs = PUSH_DEBOUNCE_MS): void {
  if (isPulling) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushLocalDataToCloud();
  }, delayMs);
}

/**
 * Wire the push side to real triggers.
 *
 * pushLocalDataToCloud() existed but had no call sites anywhere in the app, so
 * hand-entered transactions, accounts and settings lived only in on-device
 * SQLite — a reinstall lost them permanently despite the app requiring an
 * account. Returns a teardown function.
 */
export function startCloudSync(): () => void {
  const unsubscribe = onLocalMutation(() => scheduleCloudPush());

  const onAppStateChange = (state: AppStateStatus) => {
    if (state === 'active') scheduleCloudPush(1_000);
  };
  const subscription = AppState.addEventListener('change', onAppStateChange);

  return () => {
    unsubscribe();
    subscription.remove();
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  };
}
