import { prisma } from "../prisma";
import { encryptSecret, decryptSecret } from "./crypto";
import { getProvider, type BankProvider, type ProviderConnection, type ProviderTransaction } from "./bank-providers";
import { ledgerNet, stampTombstones } from "./sync/sql";

/**
 * Persistence for bank sync — provider-neutral.
 *
 * Everything here works in the app's own vocabulary via the BankProvider
 * interface, so a second provider reuses all of it. The only provider-specific
 * thing left is the `provider` key stored on each connection.
 *
 * Local ids are namespaced by provider (`plaid_<txId>`) so two providers can
 * never collide on the same row.
 *
 * What lands here reaches the phone through /sync like any other write, so it
 * follows the sync model (PLAN.md decisions 4 and 5):
 *
 *   - A mirrored BankAccount's balance is derived by a trigger from its
 *     openingBalance and its transactions. The provider's balance is matched
 *     by setting openingBalance = provider balance − the account's ledger, so
 *     the derived balance equals what the bank reports once the transactions
 *     are booked, on the server and on every device that pulls them.
 *   - Rows the server writes carry clientUpdatedAt = now, the server's time;
 *     a removal stamps its tombstone with it, so a device's older edit of a
 *     cancelled charge cannot bring it back.
 *
 * Every entry point takes an optional provider (or BankSyncOptions), for
 * tests; the routes pass none and the connection's own provider is used. The
 * access token is encrypted at rest by the process's keys (lib/crypto.ts:
 * TOKEN_ENCRYPTION_KEY when set, v2 ciphertext), and a test may pass its own.
 */

/** Encrypts provider access tokens for storage and reads them back. */
export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

/** The process's keys, from the environment (lib/crypto.ts). */
export const processCipher: TokenCipher = { encrypt: encryptSecret, decrypt: decryptSecret };

export interface BankSyncOptions {
  /** Overrides the provider named on the connection. */
  provider?: BankProvider;
  /** Overrides the process's token cipher. */
  cipher?: TokenCipher;
}

function resolveOptions(o: BankProvider | BankSyncOptions | undefined): BankSyncOptions {
  if (!o) return {};
  return "listAccounts" in o ? { provider: o } : o;
}

/** A connection that already belongs to a different user. Never re-bound. */
export class ConnectionOwnedElsewhereError extends Error {
  constructor() {
    super("this bank connection belongs to another user");
    this.name = "ConnectionOwnedElsewhereError";
  }
}

/** Stable local id for a synced transaction. */
export function transactionId(providerId: string, externalId: string): string {
  return `${providerId}_${externalId}`;
}

/** Stable local id for the BankAccount mirroring a provider account. */
export function bankAccountId(providerId: string, externalId: string): string {
  return `acc_${providerId}_${externalId}`;
}

/**
 * Store a completed connection and its accounts, then pull transactions.
 *
 * The access token is stored encrypted, never in the clear. A connection id
 * the provider already gave another user is refused rather than re-bound: the
 * row's owner is whoever linked it first.
 */
export async function persistConnection(
  userId: string,
  provider: BankProvider,
  connection: ProviderConnection,
  options: {
    cipher?: TokenCipher;
    /**
     * Pull transactions now (the default). A caller that holds a claim while
     * it links passes false and runs the first sync after letting go: a long
     * history must not hold the link open.
     */
    initialSync?: boolean;
  } = {}
) {
  const cipher = options.cipher ?? processCipher;
  const existing = await prisma.plaidItem.findUnique({
    where: { itemId: connection.externalId },
    select: { userId: true },
  });
  if (existing && existing.userId !== userId) throw new ConnectionOwnedElsewhereError();

  const item = await prisma.plaidItem.upsert({
    where: { itemId: connection.externalId },
    create: {
      userId,
      provider: provider.id,
      itemId: connection.externalId,
      accessTokenEnc: cipher.encrypt(connection.accessToken),
      institutionId: connection.institutionId,
      institutionName: connection.institutionName,
    },
    update: {
      accessTokenEnc: cipher.encrypt(connection.accessToken),
      status: "active",
    },
  });

  await refreshConnectionAccounts(item.id, { provider, cipher });
  if (options.initialSync !== false) {
    await syncConnectionTransactions(item.id, { provider, cipher }).catch(() => {});
  }
  return item;
}

/** Resolve the provider and cipher for a stored connection. */
async function loadConnection(itemRowId: string, o: BankSyncOptions) {
  const item = await prisma.plaidItem.findUnique({ where: { id: itemRowId } });
  if (!item) return null;
  return { item, provider: o.provider ?? getProvider(item.provider), cipher: o.cipher ?? processCipher };
}

/** Differences below this are float noise, not a change worth a write. */
const BALANCE_EPSILON = 1e-6;

/**
 * Mirror one provider account into the user's BankAccount `localId`, with the
 * openingBalance that makes its derived balance equal `balance`. Writes (and
 * so re-sends the account to devices) only when something visible changed.
 * Returns false when the id is taken by another user's account.
 */
export async function mirrorBankAccount(
  userId: string,
  localId: string,
  fields: { name: string; type: string; currency: string; balance: number }
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Locked first, so no ledger write lands between the sum and the write.
    const [current] = await tx.$queryRaw<
      { userId: string; name: string; type: string; currency: string; openingBalance: number }[]
    >`SELECT "userId", "name", "type", "currency", "openingBalance"
        FROM "BankAccount" WHERE "id" = ${localId} FOR UPDATE`;
    if (current && current.userId !== userId) {
      console.warn(`[bank-sync] account id ${localId} belongs to another user; not mirrored`);
      return false;
    }

    // The provider is authoritative for a linked account's balance: the opening
    // balance absorbs whatever the ledger here does not explain.
    const net = (await ledgerNet(tx, userId, [localId])).get(localId) ?? 0;
    const openingBalance = fields.balance - net;

    if (!current) {
      await tx.bankAccount.create({
        data: {
          id: localId,
          userId,
          name: fields.name,
          type: fields.type,
          openingBalance,
          currency: fields.currency,
          clientUpdatedAt: new Date(),
        },
      });
      return true;
    }

    const unchanged =
      current.name === fields.name &&
      current.type === fields.type &&
      current.currency === fields.currency &&
      Math.abs(current.openingBalance - openingBalance) < BALANCE_EPSILON;
    if (!unchanged) {
      await tx.bankAccount.update({
        where: { id: localId },
        data: {
          name: fields.name,
          type: fields.type,
          openingBalance,
          currency: fields.currency,
          clientUpdatedAt: new Date(),
        },
      });
    }
    return true;
  });
}

/**
 * Re-align a connection's mirrored accounts with the balances last reported
 * by the provider (PlaidAccount.balance), after booking changed the ledger
 * under them and the provider could not be asked again.
 */
async function realignFromLastKnownBalances(itemId: string, userId: string): Promise<void> {
  const mirrored = await prisma.plaidAccount.findMany({
    where: { itemId, bankAccountId: { not: null } },
    select: { bankAccountId: true, name: true, mask: true, type: true, currency: true, balance: true },
    orderBy: { plaidAccountId: "asc" },
  });
  for (const a of mirrored) {
    await mirrorBankAccount(userId, a.bankAccountId!, {
      name: a.mask ? `${a.name} ••${a.mask}` : a.name,
      type: a.type,
      currency: a.currency,
      balance: a.balance,
    });
  }
}

/**
 * provider account id → the BankAccount its transactions are booked against,
 * re-creating a mirror the user has deleted since (the next refresh would
 * re-create it anyway, as it always has while the link is active). Booking
 * against a missing account would fail on its foreign key and stop the whole
 * sync; an id held by another user is booked unlinked.
 */
async function ensureMirrors(itemId: string, userId: string): Promise<Map<string, string | null>> {
  const mapped = await prisma.plaidAccount.findMany({
    where: { itemId },
    select: { plaidAccountId: true, bankAccountId: true, name: true, mask: true, type: true, currency: true, balance: true },
    orderBy: { plaidAccountId: "asc" },
  });
  const ids = mapped.flatMap((a) => (a.bankAccountId ? [a.bankAccountId] : []));
  const present = new Set(
    (await prisma.bankAccount.findMany({ where: { userId, id: { in: ids } }, select: { id: true } })).map((a) => a.id)
  );
  const map = new Map<string, string | null>();
  for (const a of mapped) {
    let local = a.bankAccountId;
    if (local && !present.has(local)) {
      const mirrored = await mirrorBankAccount(userId, local, {
        name: a.mask ? `${a.name} ••${a.mask}` : a.name,
        type: a.type,
        currency: a.currency,
        balance: a.balance,
      });
      if (!mirrored) local = null;
    }
    map.set(a.plaidAccountId, local);
  }
  return map;
}

/** Pull the latest accounts/balances for a connection and mirror them locally. */
export async function refreshConnectionAccounts(
  itemRowId: string,
  options?: BankProvider | BankSyncOptions
): Promise<void> {
  const loaded = await loadConnection(itemRowId, resolveOptions(options));
  if (!loaded) return;
  const { item, provider, cipher } = loaded;

  const accounts = await provider.listAccounts(cipher.decrypt(item.accessTokenEnc));

  for (const a of accounts) {
    const existing = await prisma.plaidAccount.findUnique({
      where: { plaidAccountId: a.externalId },
      select: { bankAccountId: true },
    });

    // Mirror into a local BankAccount so synced transactions have somewhere to
    // land. Deterministic id keeps this idempotent across re-syncs.
    const localId = existing?.bankAccountId ?? bankAccountId(provider.id, a.externalId);
    const displayName = a.mask ? `${a.name} ••${a.mask}` : a.name;

    await mirrorBankAccount(item.userId, localId, {
      name: displayName,
      type: a.type,
      currency: a.currency,
      balance: a.balance,
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
        // The type too: what is a loan decides which rows are booked.
        type: a.type,
        balance: a.balance,
        currency: a.currency,
        bankAccountId: localId,
      },
    });
  }
}

/**
 * Whether a bank row only moves money between the user's own accounts and
 * debts, so it is neither spending nor income:
 *   - every row on a loan account: its payments left a checking account
 *     already, and its interest grows the debt rather than the spending;
 *   - a credit card payment, on either side;
 *   - money coming into a credit card as a payment, a transfer or "income".
 *     A card earns no salary; Plaid's sandbox files the card's payment there.
 * A refund to a card is none of these and still counts.
 */
export function isOwnMoneyMovement(
  t: Pick<ProviderTransaction, "type" | "movement">,
  accountType: string | null | undefined
): boolean {
  if (accountType === "loan") return true;
  if (t.movement === "card_payment") return true;
  return accountType === "credit" && t.type === "Income" && t.movement != null;
}

/**
 * Upper bound on sync pages per run. Providers page at a few hundred
 * transactions each, so this covers a large history in one pass; anything
 * bigger resumes next run from the saved cursor rather than keeping one run
 * writing to the database for an unbounded time.
 */
export const MAX_SYNC_PAGES = 100;

/** Apply incremental changes for one connection. Returns rows added. */
export async function syncConnectionTransactions(
  itemRowId: string,
  options?: BankProvider | BankSyncOptions
): Promise<number> {
  const loaded = await loadConnection(itemRowId, resolveOptions(options));
  if (!loaded) return 0;
  const { item, provider, cipher } = loaded;

  const accessToken = cipher.decrypt(item.accessTokenEnc);

  // A connection whose accounts were never pulled (the provider failed right
  // after the link) gets them first: booking without them would leave every
  // transaction on no account at all.
  if ((await prisma.plaidAccount.count({ where: { itemId: item.id } })) === 0) {
    await refreshConnectionAccounts(item.id, { provider, cipher });
  }

  // Accounts the user has switched off — their transactions are skipped —
  // and each account's type, for what only moves money between accounts.
  const providerAccounts = await prisma.plaidAccount.findMany({
    where: { itemId: item.id },
    select: { plaidAccountId: true, isEnabled: true, type: true },
  });
  const disabled = new Set(providerAccounts.filter((a) => !a.isEnabled).map((a) => a.plaidAccountId));
  const accountTypes = new Map(providerAccounts.map((a) => [a.plaidAccountId, a.type]));
  // A loan's payments and interest, a card payment: not spending, not income.
  const movesOwnMoney = (t: ProviderTransaction) => isOwnMoneyMovement(t, accountTypes.get(t.accountExternalId));

  // Which local BankAccount each provider account maps to, so synced rows
  // carry an accountId and actually move a balance.
  const localAccounts = await ensureMirrors(item.id, item.userId);

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
      if (disabled.has(t.accountExternalId) || movesOwnMoney(t)) continue;
      const id = transactionId(provider.id, t.externalId);
      // createMany + skipDuplicates rather than an upsert with an empty
      // update: a re-delivered row is left alone instead of being rewritten,
      // which would re-stamp it and send it to every device again.
      const { count } = await prisma.transaction.createMany({
        data: [{ id, userId: item.userId, ...row(t), clientUpdatedAt: new Date() }],
        skipDuplicates: true,
      });
      added += count;
    }

    // Pending charges post at a different amount, get recategorised, or shift
    // date. Ignoring these leaves the local copy frozen at the pending values
    // and the balance permanently wrong.
    // A modification can also show a row to be a transfer after all: it goes,
    // as a removed row does.
    const dropped: string[] = [];
    for (const t of page.modified) {
      if (disabled.has(t.accountExternalId)) continue;
      if (movesOwnMoney(t)) {
        dropped.push(t.externalId);
        continue;
      }
      // updateMany: a modification for a row we never stored (or that the
      // user deleted) changes nothing and is not an error.
      await prisma.transaction.updateMany({
        where: { id: transactionId(provider.id, t.externalId), userId: item.userId },
        data: { ...row(t), clientUpdatedAt: new Date() },
      });
    }

    // Cancelled or reversed charges. Leaving them behind means the balance
    // never recovers from a charge that never happened.
    const removedIds = [...page.removedExternalIds, ...dropped].map((id) => transactionId(provider.id, id));
    if (removedIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.transaction.deleteMany({
          where: { id: { in: removedIds }, userId: item.userId },
        });
        // The server removed them now; see the note at the top of the file.
        const at = Date.now();
        await stampTombstones(tx, item.userId, "transactions", removedIds.map((id) => ({ id, cu: at })), {
          insertMissing: false,
        });
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
  // Booking moved the ledger under the mirrored accounts; re-derive their
  // opening balances from fresh provider balances, or, when the provider cannot
  // be reached, from the last ones it reported, so the balance a device shows
  // never drifts by the booked amount.
  await refreshConnectionAccounts(item.id, { provider, cipher }).catch(() =>
    realignFromLastKnownBalances(item.id, item.userId).catch(() => {})
  );
  return added;
}

/** What a disconnect left behind, or took with it. */
export interface RemovedConnection {
  /** Mirrored accounts deleted (0 when the data was kept). */
  accounts: number;
  /** Their transactions deleted (0 when the data was kept). */
  transactions: number;
}

/**
 * Disconnect a bank: revoke it at the provider, then forget the connection.
 *
 * Revocation comes first and must succeed (or find the connection already
 * gone): it is what ends the provider's access to the user's bank and its
 * billing, and once the row is deleted the token to revoke it with is gone
 * too. A provider that cannot be reached throws, and nothing is deleted, so
 * the user can try again. A token that can no longer be decrypted can never
 * be revoked by us; the connection is forgotten anyway.
 *
 * Then, by the user's choice:
 *   keepData  the mirrored accounts and their transactions stay, as ordinary
 *             accounts and transactions that nothing updates any more;
 *   !keepData they are deleted, and the triggers' tombstones (stamped with
 *             the server's time) make every phone drop them on its next pull.
 */
/** How long deleting a connection's accounts and history may take, in one transaction. */
export const REMOVE_CONNECTION_TIMEOUT_MS = 60_000;

export async function removeConnection(
  itemRowId: string,
  options: BankSyncOptions & { keepData?: boolean } = {}
): Promise<RemovedConnection> {
  const loaded = await loadConnection(itemRowId, options);
  if (!loaded) return { accounts: 0, transactions: 0 };
  const { item, provider, cipher } = loaded;

  let accessToken: string | null = null;
  try {
    accessToken = cipher.decrypt(item.accessTokenEnc);
  } catch {
    console.warn(`[bank-sync] connection ${item.id}: token unreadable, cannot revoke upstream`);
  }
  if (accessToken !== null) await provider.removeConnection(accessToken);

  if (options.keepData !== false) {
    await prisma.plaidItem.delete({ where: { id: item.id } });
    return { accounts: 0, transactions: 0 };
  }

  return prisma.$transaction(
    async (tx) => {
      const mapped = await tx.plaidAccount.findMany({
        where: { itemId: item.id, bankAccountId: { not: null } },
        select: { bankAccountId: true },
        orderBy: { plaidAccountId: "asc" },
      });
      // Only this user's own rows: an id held by someone else was never a mirror.
      const accountIds = (
        await tx.bankAccount.findMany({
          where: { userId: item.userId, id: { in: mapped.map((a) => a.bankAccountId!) } },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      ).map((a) => a.id);

      // One statement however long the history: a list of ids as bind
      // parameters would hit Postgres's limit on a two-year account.
      const deleted = accountIds.length
        ? await tx.$queryRaw<{ id: string }[]>`
            DELETE FROM "Transaction"
             WHERE "userId" = ${item.userId} AND "accountId" = ANY(${accountIds}::text[])
            RETURNING "id"`
        : [];
      await tx.bankAccount.deleteMany({ where: { userId: item.userId, id: { in: accountIds } } });
      await tx.plaidItem.delete({ where: { id: item.id } });

      // The server deleted them now; see the note at the top of the file.
      const at = Date.now();
      await stampTombstones(tx, item.userId, "transactions", deleted.map((r) => ({ id: r.id, cu: at })), {
        insertMissing: false,
      });
      await stampTombstones(tx, item.userId, "accounts", accountIds.map((id) => ({ id, cu: at })), {
        insertMissing: false,
      });
      return { accounts: accountIds.length, transactions: deleted.length };
    },
    // Every deleted transaction runs the balance and tombstone triggers.
    { timeout: REMOVE_CONNECTION_TIMEOUT_MS }
  );
}
