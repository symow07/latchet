/**
 * Provider-neutral bank-sync contract.
 *
 * Plaid's Transactions product covers exactly 20 countries (US, CA and 18 in
 * the EU). Morocco and China are not among them, and Alipay/WeChat are
 * unreachable by any aggregator — which is why file import, not bank sync, is
 * the universal rail. Adding Salt Edge (73 countries) or TrueLayer (64) later
 * should be additive: a new module implementing this interface, with the
 * persistence and routing above it untouched.
 *
 * Everything crossing this boundary is in the app's own vocabulary. A provider
 * module owns its wire format, its auth scheme and its webhook signing, and
 * nothing above it should ever see a `plaid_` prefix or an `iso_currency_code`.
 */

/** A link attempt the user has been sent off to complete. */
export interface LinkSession {
  /** Opaque token identifying this attempt, used to correlate the callback. */
  linkToken: string;
  /** URL to open in a browser, when the provider offers a hosted flow. */
  hostedUrl: string | null;
  /** ISO timestamp, when the provider reports one. */
  expiresAt: string | null;
}

/** A completed connection to one institution. */
export interface ProviderConnection {
  /** The provider's stable id for this connection (Plaid calls it item_id). */
  externalId: string;
  /** Long-lived credential. The caller encrypts this before it is stored. */
  accessToken: string;
  institutionId?: string;
  institutionName?: string;
}

/** One account exposed by a connection, already in our type vocabulary. */
export interface ProviderAccount {
  externalId: string;
  name: string;
  mask?: string;
  /** cash|checking|savings|credit|investment|other */
  type: string;
  balance: number;
  currency: string;
}

/** One transaction, already normalised — sign resolved, category mapped. */
export interface ProviderTransaction {
  externalId: string;
  accountExternalId: string;
  /** Always positive; direction is carried by `type`. */
  amount: number;
  type: "Expense" | "Income";
  category: string;
  note: string;
  /** YYYY-MM-DD. */
  dateISO: string;
  currency: string;
}

/**
 * One page of incremental changes.
 *
 * All three lists matter: a pending charge that posts at a different amount
 * arrives as `modified`, and a cancelled one as `removed`. Applying only
 * `added` leaves balances permanently wrong.
 */
export interface TransactionPage {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removedExternalIds: string[];
  /** Opaque resume point, persisted so a capped run continues next time. */
  cursor: string | undefined;
  hasMore: boolean;
}

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

/** What a provider's webhook is telling us, in neutral terms. */
export type WebhookEvent =
  | { kind: "link-finished"; linkToken: string; publicTokens: string[] }
  | { kind: "transactions-changed"; connectionExternalId: string }
  | { kind: "ignored" };

export interface CreateLinkSessionParams {
  userId: string;
  /** Drives which country's institutions are offered. */
  currency: string | null | undefined;
  /** Where the provider should send webhooks. */
  webhookUrl: string;
}

export interface BankProvider {
  /** Stable key stored on each connection row. */
  readonly id: string;

  /** False when credentials are absent; routes answer 503 rather than failing. */
  isConfigured(): boolean;

  createLinkSession(params: CreateLinkSessionParams): Promise<LinkSession>;

  /** Trade the short-lived token from the link flow for a durable one. */
  exchange(publicToken: string): Promise<ProviderConnection>;

  listAccounts(accessToken: string): Promise<ProviderAccount[]>;

  syncTransactions(accessToken: string, cursor?: string): Promise<TransactionPage>;

  /** Revoke upstream. Callers still delete locally if this fails. */
  removeConnection(accessToken: string): Promise<void>;

  /**
   * Prove a webhook came from the provider. Takes the raw body because
   * signatures cover exact bytes — re-serialised JSON will not match.
   */
  verifyWebhook(
    header: (name: string) => string | undefined,
    rawBody: string
  ): Promise<WebhookVerification>;

  parseWebhook(body: unknown): WebhookEvent;
}
