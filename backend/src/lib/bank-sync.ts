import { prisma } from "../prisma";
import { encryptSecret, decryptSecret } from "./crypto";
import { getProvider, type BankProvider, type ProviderConnection } from "./bank-providers";

/**
 * Persistence for bank sync — provider-neutral.
 *
 * Everything here works in the app's own vocabulary via the BankProvider
 * interface, so a second provider reuses all of it. The only provider-specific
 * thing left is the `provider` key stored on each connection.
 *
 * Local ids are namespaced by provider (`plaid_<txId>`) so two providers can
 * never collide on the same row.
 */

/** Stable local id for a synced transaction. */
export function transactionId(providerId: string, externalId: string): string {
  return `${providerId}_${externalId}`;
}

/** Stable local id for the BankAccount mirroring a provider account. */
export function bankAccountId(providerId: string, externalId: string): string {
  return `acc_${providerId}_${externalId}`;
}

/** Store a completed connection and its accounts, then pull transactions. */
export async function persistConnection(
  userId: string,
  provider: BankProvider,
  connection: ProviderConnection
) {
  const item = await prisma.plaidItem.upsert({
    where: { itemId: connection.externalId },
    create: {
      userId,
      provider: provider.id,
      itemId: connection.externalId,
      accessTokenEnc: encryptSecret(connection.accessToken),
      institutionId: connection.institutionId,
      institutionName: connection.institutionName,
    },
    update: {
      accessTokenEnc: encryptSecret(connection.accessToken),
      status: "active",
    },
  });

  await refreshConnectionAccounts(item.id);
  await syncConnectionTransactions(item.id).catch(() => {});
  return item;
}

/** Resolve the provider that owns a stored connection. */
async function loadConnection(itemRowId: string) {
  const item = await prisma.plaidItem.findUnique({ where: { id: itemRowId } });
  if (!item) return null;
  return { item, provider: getProvider(item.provider) };
}

/** Pull the latest accounts/balances for a connection and mirror them locally. */
export async function refreshConnectionAccounts(itemRowId: string): Promise<void> {
  const loaded = await loadConnection(itemRowId);
  if (!loaded) return;
  const { item, provider } = loaded;

  const accounts = await provider.listAccounts(decryptSecret(item.accessTokenEnc));

  for (const a of accounts) {
    const existing = await prisma.plaidAccount.findUnique({
      where: { plaidAccountId: a.externalId },
      select: { bankAccountId: true },
    });

    // Mirror into a local BankAccount so synced transactions have somewhere to
    // land. Deterministic id keeps this idempotent across re-syncs.
    const localId = existing?.bankAccountId ?? bankAccountId(provider.id, a.externalId);
    const displayName = a.mask ? `${a.name} ••${a.mask}` : a.name;

    await prisma.bankAccount.upsert({
      where: { id: localId },
      create: {
        id: localId,
        userId: item.userId,
        name: displayName,
        type: a.type,
        balance: a.balance,
        currency: a.currency,
      },
      update: {
        name: displayName,
        type: a.type,
        // The provider is authoritative for a linked account's balance.
        balance: a.balance,
        currency: a.currency,
      },
    });

    await prisma.plaidAccount.upsert({
      where: { plaidAccountId: a.externalId },
      create: {
        itemId: item.id,
        plaidAccountId: a.externalId,
        name: a.name,
        type: a.type,
        mask: a.mask,
        balance: a.balance,
        currency: a.currency,
        bankAccountId: localId,
      },
      update: {
        name: a.name,
        balance: a.balance,
        currency: a.currency,
        bankAccountId: localId,
      },
    });
  }
}

/**
 * Upper bound on sync pages per run. Providers page at a few hundred
 * transactions each, so this covers a large history in one pass; anything
 * bigger resumes next run from the saved cursor rather than holding the single
 * SQLite writer open indefinitely.
 */
export const MAX_SYNC_PAGES = 100;

/** Apply incremental changes for one connection. Returns rows added. */
export async function syncConnectionTransactions(itemRowId: string): Promise<number> {
  const loaded = await loadConnection(itemRowId);
  if (!loaded) return 0;
  const { item, provider } = loaded;

  const accessToken = decryptSecret(item.accessTokenEnc);

  // Accounts the user has switched off — their transactions are skipped.
  const disabled = new Set(
    (
      await prisma.plaidAccount.findMany({
        where: { itemId: item.id, isEnabled: false },
        select: { plaidAccountId: true },
      })
    ).map((a) => a.plaidAccountId)
  );

  // Which local BankAccount each provider account maps to, so synced rows
  // carry an accountId and actually move a balance.
  const localAccounts = new Map(
    (
      await prisma.plaidAccount.findMany({
        where: { itemId: item.id },
        select: { plaidAccountId: true, bankAccountId: true },
      })
    ).map((a) => [a.plaidAccountId, a.bankAccountId])
  );

  const row = (t: {
    accountExternalId: string;
    amount: number;
    type: string;
    category: string;
    note: string;
    dateISO: string;
    currency: string;
  }) => ({
    accountId: localAccounts.get(t.accountExternalId) ?? null,
    amount: t.amount,
    category: t.category,
    type: t.type,
    note: t.note,
    dateISO: t.dateISO,
    currency: t.currency,
  });

  let cursor = item.cursor ?? undefined;
  let added = 0;
  let hasMore = true;
  let pages = 0;

  while (hasMore && pages < MAX_SYNC_PAGES) {
    const page = await provider.syncTransactions(accessToken, cursor);
    pages++;

    for (const t of page.added) {
      if (disabled.has(t.accountExternalId)) continue;
      const id = transactionId(provider.id, t.externalId);
      await prisma.transaction.upsert({
        where: { id },
        create: { id, userId: item.userId, ...row(t) },
        update: {},
      });
      added++;
    }

    // Pending charges post at a different amount, get recategorised, or shift
    // date. Ignoring these leaves the local copy frozen at the pending values
    // and the balance permanently wrong.
    for (const t of page.modified) {
      if (disabled.has(t.accountExternalId)) continue;
      await prisma.transaction
        .update({
          where: { id: transactionId(provider.id, t.externalId) },
          data: row(t),
        })
        // A modification for a row we never stored is not an error.
        .catch(() => {});
    }

    // Cancelled or reversed charges. Leaving them behind means the balance
    // never recovers from a charge that never happened.
    const removedIds = page.removedExternalIds.map((id) => transactionId(provider.id, id));
    if (removedIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: { id: { in: removedIds }, userId: item.userId },
      });
    }

    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  if (hasMore) {
    console.warn(
      `[bank-sync] connection ${item.id} hit the ${MAX_SYNC_PAGES}-page cap; resuming next run`
    );
  }

  await prisma.plaidItem.update({
    where: { id: item.id },
    data: { cursor, updatedAt: new Date() },
  });
  await refreshConnectionAccounts(item.id).catch(() => {});
  return added;
}

/** Revoke upstream and delete locally. Local deletion happens either way. */
export async function removeConnection(itemRowId: string): Promise<void> {
  const loaded = await loadConnection(itemRowId);
  if (!loaded) return;
  const { item, provider } = loaded;

  try {
    await provider.removeConnection(decryptSecret(item.accessTokenEnc));
  } catch {
    /* still delete locally even if revoke fails */
  }
  await prisma.plaidItem.delete({ where: { id: item.id } });
}
