import { env } from "../../env";
import { fetchWithTimeout, type TimeoutInit } from "../fetch-timeout";
import { categoryForTransaction, mapAccountType, movementOf } from "../plaid-mappers";
import { verifyPlaidWebhook, type PlaidJwk } from "../plaid-webhook";
import { countryCodesForLink, linkLanguage, parseEnabledCountries } from "../plaid-countries";
import {
  BankProviderError,
  type BankProvider,
  type CreateLinkSessionParams,
  type LinkSession,
  type LinkSessionResult,
  type ProviderAccount,
  type ProviderConnection,
  type ProviderTransaction,
  type TransactionPage,
  type WebhookEvent,
  type WebhookVerification,
} from "./types";

/**
 * Plaid, behind the BankProvider interface.
 *
 * Everything Plaid-shaped lives here: the REST envelope, the error vocabulary,
 * the account/category vocabularies, the ES256 webhook signature, the sign
 * convention. Callers see only the neutral types in ./types.
 *
 * Plaid has two environments: Sandbox (free, test institutions and test
 * credentials) and Production. Its third, Development, was retired in 2024;
 * env.ts refuses it at boot.
 */

const PLAID_HOSTS: Record<"sandbox" | "production", string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

/**
 * How long a Hosted Link URL stays usable. Plaid's own default for a link it
 * does not deliver; set explicitly so the link session we remember outlives it.
 */
export const HOSTED_LINK_LIFETIME_SECONDS = 30 * 60;

/**
 * Transaction history requested at link. Plaid's maximum: a yearly
 * subscription is recognised by its second charge, which needs more than a
 * year of history, and the default 90 days cannot show one at all.
 */
export const TRANSACTION_DAYS_REQUESTED = 730;

/** What a Plaid provider is built from. */
export interface PlaidConfig {
  clientId: string | undefined;
  secret: string | undefined;
  environment: "sandbox" | "production";
  /** The enabled-country list, as PLAID_COUNTRY_CODES spells it. */
  countryCodes: string | undefined;
  /** Replaces the environment's host. Tests point it at a fake Plaid. */
  baseUrl?: string;
  /** The HTTP client. Defaults to fetchWithTimeout; tests pass a fake. */
  fetch?: (url: string, init: TimeoutInit) => Promise<Response>;
}

/** Plaid's error envelope. */
interface PlaidErrorBody {
  error_type?: string;
  error_code?: string;
  error_message?: string;
  display_message?: string | null;
}

/** Codes meaning the Item is already gone: removing it again is done, not failed. */
const GONE_CODES = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);
/** Error types for a request of ours Plaid will never accept as sent. */
const CONFIG_TYPES = new Set(["INVALID_REQUEST", "INVALID_INPUT", "INVALID_RESULT"]);
/** Error types for an outage, here or at the bank: worth retrying later. */
const UNAVAILABLE_TYPES = new Set(["API_ERROR", "INSTITUTION_ERROR", "RATE_LIMIT_EXCEEDED"]);

/** A Plaid failure in neutral terms. Never carries the request (it holds our secret). */
export function plaidError(path: string, status: number, body: unknown): BankProviderError {
  const b = (body && typeof body === "object" ? body : {}) as PlaidErrorBody;
  const code = typeof b.error_code === "string" ? b.error_code : null;
  const type = typeof b.error_type === "string" ? b.error_type : null;
  const kind: BankProviderError["kind"] =
    code && GONE_CODES.has(code)
      ? "gone"
      : status === 429 || status >= 500 || (type !== null && UNAVAILABLE_TYPES.has(type))
        ? "unavailable"
        : type !== null && CONFIG_TYPES.has(type)
          ? "config"
          : "rejected";
  const detail = typeof b.error_message === "string" ? b.error_message.slice(0, 300) : "";
  return new BankProviderError(`Plaid ${path} ${status}${code ? ` ${code}` : ""}${detail ? `: ${detail}` : ""}`, {
    kind,
    providerCode: code,
    displayMessage: typeof b.display_message === "string" && b.display_message ? b.display_message : null,
    httpStatus: status,
  });
}

/**
 * Normalise one Plaid transaction.
 *
 * Plaid signs money *out* as positive, which is the opposite of the app's
 * convention, so the sign is resolved here rather than at every call site.
 * The category comes from personal_finance_category, the legacy `category`
 * array only when that is absent; the note is the cleaned merchant name, then
 * Plaid's deprecated `name`.
 */
export function toProviderTransaction(t: any): ProviderTransaction {
  return {
    externalId: t.transaction_id,
    accountExternalId: t.account_id,
    amount: Math.abs(t.amount),
    type: t.amount >= 0 ? "Expense" : "Income",
    category: categoryForTransaction(t),
    note: t.merchant_name ?? t.name ?? "",
    dateISO: t.date,
    currency: t.iso_currency_code ?? "USD",
    movement: movementOf(t.personal_finance_category),
  };
}

/** Normalise one Plaid account. */
export function toProviderAccount(a: any): ProviderAccount {
  return {
    externalId: a.account_id,
    name: a.name,
    mask: a.mask,
    type: mapAccountType(a.type, a.subtype),
    balance: a.balances?.current ?? 0,
    currency: a.balances?.iso_currency_code ?? "USD",
  };
}

/** Public tokens in a webhook body, from either the list or the single field. */
function publicTokensOf(body: any): string[] {
  const list = Array.isArray(body?.public_tokens) ? body.public_tokens : [];
  const single = typeof body?.public_token === "string" ? [body.public_token] : [];
  return [...new Set([...list, ...single].filter((t): t is string => typeof t === "string" && t.length > 0))];
}

/**
 * Translate a Plaid webhook body into a neutral event.
 *
 * Hosted Link reports a linked institution twice: ITEM_ADD_RESULT as each one
 * is added, and SESSION_FINISHED (status SUCCESS) with all of them at the end.
 * Both become "link-finished"; the exchange is once per public token however
 * many deliveries carry it.
 */
export function toWebhookEvent(body: any): WebhookEvent {
  const webhookType = body?.webhook_type as string | undefined;
  const webhookCode = body?.webhook_code as string | undefined;
  const linkToken = typeof body?.link_token === "string" ? body.link_token : "";

  if (webhookType === "LINK" && linkToken) {
    const succeeded =
      webhookCode === "ITEM_ADD_RESULT" ||
      (webhookCode === "SESSION_FINISHED" && String(body?.status ?? "").toUpperCase() === "SUCCESS");
    const publicTokens = publicTokensOf(body);
    if (succeeded && publicTokens.length > 0) {
      return { kind: "link-finished", linkToken, publicTokens };
    }
    return { kind: "ignored" };
  }

  const itemId = body?.item_id as string | undefined;
  if (itemId && (webhookCode === "SYNC_UPDATES_AVAILABLE" || webhookCode === "DEFAULT_UPDATE")) {
    return { kind: "transactions-changed", connectionExternalId: itemId };
  }

  return { kind: "ignored" };
}

/** How a Hosted Link session ended, from a /link/token/get response. */
export function toLinkSessionResult(data: any): LinkSessionResult {
  const sessions: any[] = Array.isArray(data?.link_sessions) ? data.link_sessions : [];
  const tokens: string[] = [];
  for (const s of sessions) {
    const adds: any[] = Array.isArray(s?.results?.item_add_results) ? s.results.item_add_results : [];
    for (const r of adds) if (typeof r?.public_token === "string") tokens.push(r.public_token);
    // Legacy integrations only; replaced by results.item_add_results.
    if (typeof s?.on_success?.public_token === "string") tokens.push(s.on_success.public_token);
  }
  const publicTokens = [...new Set(tokens.filter((t) => t.length > 0))];
  if (publicTokens.length > 0) return { status: "success", publicTokens, exit: null };

  // The latest exit says why the user left; a finished session with neither
  // results nor an exit also ended without a bank.
  const exited = [...sessions].reverse().find((s) => s?.exit);
  if (exited) {
    return {
      status: "exited",
      publicTokens: [],
      exit: {
        code: typeof exited.exit?.error?.error_code === "string" ? exited.exit.error.error_code : null,
        status: typeof exited.exit?.status === "string" ? exited.exit.status : null,
      },
    };
  }
  if (sessions.some((s) => s?.finished_at)) return { status: "exited", publicTokens: [], exit: null };
  return { status: "pending", publicTokens: [], exit: null };
}

/** A Plaid provider for one set of credentials. */
export function createPlaidProvider(config: PlaidConfig): BankProvider {
  const host = config.baseUrl ?? PLAID_HOSTS[config.environment] ?? PLAID_HOSTS.sandbox;
  const send = config.fetch ?? fetchWithTimeout;
  const enabledCountries = () => parseEnabledCountries(config.countryCodes);

  /** Call a Plaid endpoint with the credentials injected; failures as BankProviderError. */
  async function plaid<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await send(`${host}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
      });
    } catch (e) {
      // A timeout or a refused connection: Plaid, or the way to it, is down.
      throw new BankProviderError(`Plaid ${path}: ${e instanceof Error ? e.message : String(e)}`, {
        kind: "unavailable",
      });
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // A proxy's error page, say. The status says enough.
    }
    if (!res.ok) throw plaidError(path, res.status, json);
    return json as T;
  }

  // Webhook verification keys, cached by key_id. A given key_id always maps to
  // the same key, so this only grows by the handful Plaid rotates through — and
  // it stops a burst of webhooks becoming a burst of key fetches.
  //
  // Deliberately per process, the one piece of server state not moved to
  // Postgres (DEPLOYMENT.md §4): the keys are public and immutable per key_id,
  // so a second instance with an empty cache costs one refetch, never
  // correctness.
  const verificationKeys = new Map<string, PlaidJwk>();

  async function getVerificationKey(keyId: string): Promise<PlaidJwk | null> {
    const cached = verificationKeys.get(keyId);
    if (cached) return cached;
    try {
      const res = await plaid<{ key: PlaidJwk }>("/webhook_verification_key/get", { key_id: keyId });
      if (!res?.key) return null;
      // Never cache a key Plaid has already retired.
      if (!res.key.expired_at) verificationKeys.set(keyId, res.key);
      return res.key;
    } catch (e) {
      console.warn("[plaid:webhook] key fetch failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }

  return {
    id: "plaid",

    isConfigured() {
      return !!config.clientId && !!config.secret;
    },

    describe() {
      return { countries: enabledCountries(), environment: config.environment };
    },

    async createLinkSession(params: CreateLinkSessionParams): Promise<LinkSession> {
      // Offer the institutions of the country the user actually banks in,
      // bounded by what this Plaid account is enabled for.
      const countryCodes = countryCodesForLink(
        { region: params.region, currency: params.currency },
        enabledCountries()
      );

      const data = await plaid<{
        link_token: string;
        expiration: string;
        hosted_link_url?: string;
      }>("/link/token/create", {
        user: { client_user_id: params.userId },
        client_name: "Latchet",
        products: ["transactions"],
        transactions: { days_requested: TRANSACTION_DAYS_REQUESTED },
        country_codes: countryCodes,
        language: linkLanguage(params.language),
        webhook: params.webhookUrl,
        // Hosted Link opens the bank login in the system browser session
        // (expo-web-browser) without bundling Plaid's native SDK. When it ends,
        // successfully or not, Plaid sends the browser to the completion
        // redirect — our route, which finishes the link and hands the result
        // back to the app. The SESSION_FINISHED webhook is the second path.
        hosted_link: {
          ...(params.completionRedirectUri
            ? { completion_redirect_uri: params.completionRedirectUri }
            : {}),
          url_lifetime_seconds: HOSTED_LINK_LIFETIME_SECONDS,
        },
      });

      return {
        linkToken: data.link_token,
        hostedUrl: data.hosted_link_url ?? null,
        expiresAt: data.expiration ?? null,
      };
    },

    async getLinkSessionResult(linkToken: string): Promise<LinkSessionResult> {
      return toLinkSessionResult(await plaid("/link/token/get", { link_token: linkToken }));
    },

    async exchange(publicToken: string): Promise<ProviderConnection> {
      const exchanged = await plaid<{ access_token: string; item_id: string }>(
        "/item/public_token/exchange",
        { public_token: publicToken }
      );

      // Institution metadata is presentation-only; never fail the link over it.
      let institutionId: string | undefined;
      let institutionName: string | undefined;
      try {
        const itemInfo = await plaid<{ item: { institution_id?: string } }>("/item/get", {
          access_token: exchanged.access_token,
        });
        institutionId = itemInfo.item.institution_id ?? undefined;
        if (institutionId) {
          const inst = await plaid<{ institution: { name: string } }>("/institutions/get_by_id", {
            institution_id: institutionId,
            country_codes: enabledCountries(),
          });
          institutionName = inst.institution.name;
        }
      } catch {
        /* institution lookup is non-fatal */
      }

      return {
        externalId: exchanged.item_id,
        accessToken: exchanged.access_token,
        institutionId,
        institutionName,
      };
    },

    async listAccounts(accessToken: string): Promise<ProviderAccount[]> {
      const data = await plaid<{ accounts: any[] }>("/accounts/get", { access_token: accessToken });
      return (data.accounts ?? []).map(toProviderAccount);
    },

    async syncTransactions(accessToken: string, cursor?: string): Promise<TransactionPage> {
      const page = await plaid<{
        added: any[];
        modified: any[];
        removed: Array<{ transaction_id: string }>;
        next_cursor: string;
        has_more: boolean;
      }>("/transactions/sync", { access_token: accessToken, cursor, count: 500 });

      return {
        added: (page.added ?? []).map(toProviderTransaction),
        modified: (page.modified ?? []).map(toProviderTransaction),
        removedExternalIds: (page.removed ?? []).map((r) => r.transaction_id),
        cursor: page.next_cursor,
        hasMore: page.has_more,
      };
    },

    async removeConnection(accessToken: string): Promise<void> {
      try {
        await plaid("/item/remove", { access_token: accessToken });
      } catch (e) {
        // Already removed — by an earlier attempt, or by the user at
        // my.plaid.com. What was asked for is true.
        if (e instanceof BankProviderError && e.kind === "gone") return;
        throw e;
      }
    },

    async verifyWebhook(
      header: (name: string) => string | undefined,
      rawBody: string
    ): Promise<WebhookVerification> {
      return verifyPlaidWebhook(header("Plaid-Verification"), rawBody, { getKey: getVerificationKey });
    },

    parseWebhook(body: unknown): WebhookEvent {
      return toWebhookEvent(body);
    },
  };
}

/** The provider this deployment is configured for. */
export const plaidProvider: BankProvider = createPlaidProvider({
  clientId: env.PLAID_CLIENT_ID,
  secret: env.PLAID_SECRET,
  environment: env.PLAID_ENV,
  countryCodes: env.PLAID_COUNTRY_CODES,
});
