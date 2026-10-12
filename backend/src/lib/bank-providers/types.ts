/**
 * Provider-neutral bank-sync contract.
 *
 * Plaid's Transactions product covers exactly 20 countries (US, CA, GB and 17
 * in the EU and EEA). Morocco and China are not among them, and Alipay/WeChat are
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

/**
 * What a provider's webhook is telling us, in neutral terms. "link-finished"
 * carries the public tokens a link session produced, from whichever of the
 * provider's link webhooks carried them; the same token may arrive more than
 * once and is exchanged once.
 */
export type WebhookEvent =
  | { kind: "link-finished"; linkToken: string; publicTokens: string[] }
  | { kind: "transactions-changed"; connectionExternalId: string }
  | { kind: "ignored" };

export interface CreateLinkSessionParams {
  userId: string;
  /** The phone's region (ISO 3166-1 alpha-2), the first hint at where the user banks. */
  region?: string | null;
  /** The app's currency, the second hint. */
  currency: string | null | undefined;
  /** The app's language, for the provider's own screens. */
  language?: string | null;
  /** Where the provider should send webhooks. */
  webhookUrl: string;
  /**
   * Where the hosted flow sends the browser when it ends, whether the user
   * linked a bank or gave up. A route of ours, which carries the result back
   * into the app.
   */
  completionRedirectUri?: string | null;
}

/** How a link session ended, read back from the provider. */
export interface LinkSessionResult {
  /**
   * success: at least one institution was linked; exited: the user left (or
   * the bank refused) without linking; pending: the session has not finished.
   */
  status: "success" | "exited" | "pending";
  /** Short-lived tokens to exchange, one per linked institution. */
  publicTokens: string[];
  /** Why the user left, when they did: the provider's error code and exit status. */
  exit: { code: string | null; status: string | null } | null;
}

/**
 * A provider call that failed, classified so callers can decide what to do
 * without reading the provider's vocabulary:
 *   config       our credentials or request are wrong — an operator problem;
 *   gone         the connection no longer exists upstream (already removed,
 *                token invalid) — treat a removal as done;
 *   unavailable  the provider or the bank is down, slow or rate-limiting —
 *                worth retrying later;
 *   rejected     anything else the provider refused.
 * `providerCode` is the provider's own code (Plaid's error_code) and
 * `displayMessage` the provider's sentence written for end users, if any.
 */
export class BankProviderError extends Error {
  readonly kind: "config" | "gone" | "unavailable" | "rejected";
  readonly providerCode: string | null;
  readonly displayMessage: string | null;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    details: {
      kind: BankProviderError["kind"];
      providerCode?: string | null;
      displayMessage?: string | null;
      httpStatus?: number | null;
    }
  ) {
    super(message);
    this.name = "BankProviderError";
    this.kind = details.kind;
    this.providerCode = details.providerCode ?? null;
    this.displayMessage = details.displayMessage ?? null;
    this.httpStatus = details.httpStatus ?? null;
  }
}

export interface BankProvider {
  /** Stable key stored on each connection row. */
  readonly id: string;

  /** False when credentials are absent; routes answer 503 rather than failing. */
  isConfigured(): boolean;

  /**
   * The countries this deployment can link banks in, and the provider's
   * environment name. Nothing secret: the phone reads it to decide whether to
   * offer bank linking at all.
   */
  describe?(): { countries: string[]; environment: string };

  createLinkSession(params: CreateLinkSessionParams): Promise<LinkSession>;

  /**
   * How the link session `linkToken` ended, and its public tokens. Lets the
   * server finish a link when the provider's webhook cannot reach it.
   */
  getLinkSessionResult?(linkToken: string): Promise<LinkSessionResult>;

  /** Trade the short-lived token from the link flow for a durable one. */
  exchange(publicToken: string): Promise<ProviderConnection>;

  listAccounts(accessToken: string): Promise<ProviderAccount[]>;

  syncTransactions(accessToken: string, cursor?: string): Promise<TransactionPage>;

  /**
   * Revoke upstream, ending the provider's access and its billing. Resolves
   * when the connection is gone, including when it already was; throws (a
   * BankProviderError where it can) when it may still be live.
   */
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
