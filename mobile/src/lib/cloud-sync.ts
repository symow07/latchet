/**
 * Cloud sync layer — syncs local SQLite data to/from the backend.
 * All operations are best-effort: local data is always the source of truth.
 */
import { api } from "./api/api";
import {
  getTransactions,
  getAccounts,
  getSettings,
  addTransaction,
  createAccount,
  updateAccount,
  updateSettings,
} from "./db";

export interface SyncResult {
  success: boolean;
  error?: string;
}

/** Push all local data to the cloud for the first time (after sign-in) */
export async function pushLocalDataToCloud(): Promise<SyncResult> {
  try {
    const [transactions, accounts, settings] = await Promise.all([
      getTransactions(),
      getAccounts(),
      getSettings(),
    ]);

    await Promise.all([
      api.post("/api/transactions/sync", { transactions }),
      api.post("/api/accounts/sync", { accounts }),
      api.put("/api/settings", settings),
    ]);

    return { success: true };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.warn("[CloudSync] pushLocalDataToCloud failed:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

/** Pull cloud data down and merge into local SQLite */
export async function pullCloudDataToLocal(): Promise<SyncResult> {
  try {
    const [txResponse, cloudAccounts, cloudSettings] = await Promise.all([
      api.get<{ data: any[] }>("/api/transactions"),
      api.get<any[]>("/api/accounts"),
      api.get<any>("/api/settings"),
    ]);
    const cloudTransactions = txResponse?.data ?? [];

    // Sync accounts first (transactions depend on them)
    const localAccounts = await getAccounts();
    const localAccountIds = new Set(localAccounts.map((a) => a.id));

    for (const acc of cloudAccounts) {
      if (!localAccountIds.has(acc.id)) {
        await createAccount({
          name: acc.name,
          type: acc.type,
          balance: acc.balance,
          currency: acc.currency,
          color: acc.color,
          icon: acc.icon,
          isDefault: acc.isDefault,
        }).catch(() => {});
      } else {
        await updateAccount(acc.id, acc).catch(() => {});
      }
    }

    // Sync transactions
    const localTxs = await getTransactions();
    const localTxIds = new Set(localTxs.map((t) => t.id));

    for (const tx of cloudTransactions) {
      if (!localTxIds.has(tx.id)) {
        await addTransaction({
          amount: tx.amount,
          category: tx.category,
          type: tx.type,
          isImpulse: Boolean(tx.isImpulse),
          note: tx.note,
          dateISO: tx.dateISO,
          accountId: tx.accountId,
          currency: tx.currency,
        }).catch(() => {});
      }
    }

    // Sync settings
    if (cloudSettings) {
      await updateSettings(cloudSettings).catch(() => {});
    }

    return { success: true };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.warn("[CloudSync] pullCloudDataToLocal failed:", errorMessage);
    return { success: false, error: errorMessage };
  }
}
