import { env } from "../../env";
import { fetchWithTimeout } from "../fetch-timeout";
import { mapAccountType, mapCategory } from "../plaid-mappers";
import { verifyPlaidWebhook, type PlaidJwk } from "../plaid-webhook";
import { countryCodesForCurrency, parseEnabledCountries } from "../plaid-countries";
import type {
  BankProvider,
  CreateLinkSessionParams,
  LinkSession,
  ProviderAccount,
  ProviderConnection,
  ProviderTransaction,
  TransactionPage,
  WebhookEvent,
  WebhookVerification,
} from "./types";

/**
 * Plaid, behind the BankProvider interface.
 *
 * Everything Plaid-shaped lives here: the REST envelope, the account/category
 * vocabularies, the ES256 webhook signature, the sign convention. Callers see
 * only the neutral types in ./types.
 */

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

/** Call a Plaid endpoint with the shared credentials injected. */
async function plaid<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const host = PLAID_HOSTS[env.PLAID_ENV] ?? PLAID_HOSTS.sandbox;
  const res = await fetchWithTimeout(`${host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Plaid ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json as T;
}

// Webhook verification keys, cached by key_id. A given key_id always maps to
// the same key, so this only grows by the handful Plaid rotates through — and
// it stops a burst of webhooks becoming a burst of key fetches.
const verificationKeys = new Map<string, PlaidJwk>();

async function getVerificationKey(keyId: string): Promise<PlaidJwk | null> {
  const cached = verificationKeys.get(keyId);
  if (cached) return cached;
  try {
    const res = await plaid<{ key: PlaidJwk }>("/webhook_verification_key/get", {
      key_id: keyId,
    });
    if (!res?.key) return null;
    // Never cache a key Plaid has already retired.
    if (!res.key.expired_at) verificationKeys.set(keyId, res.key);
    return res.key;
  } catch (e) {
    console.warn(
      "[plaid:webhook] key fetch failed:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Normalise one Plaid transaction.
 *
 * Plaid signs money *out* as positive, which is the opposite of the app's
 * convention, so the sign is resolved here rather than at every call site.
 */
export function toProviderTransaction(t: any): ProviderTransaction {
  return {
    externalId: t.transaction_id,
    accountExternalId: t.account_id,
    amount: Math.abs(t.amount),
    type: t.amount >= 0 ? "Expense" : "Income",
    category: mapCategory(t.category),
    note: t.name ?? t.merchant_name ?? "",
    dateISO: t.date,
    currency: t.iso_currency_code ?? "USD",
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

/** Translate a Plaid webhook body into a neutral event. */
export function toWebhookEvent(body: any): WebhookEvent {
  const webhookType = body?.webhook_type as string | undefined;
  const webhookCode = body?.webhook_code as string | undefined;

  if (
    webhookType === "LINK" &&
    webhookCode === "SESSION_FINISHED" &&
    body?.status === "SUCCESS"
  ) {
    return {
      kind: "link-finished",
      linkToken: String(body?.link_token ?? ""),
      publicTokens: (body?.public_tokens as string[] | undefined) ?? [],
    };
  }

  const itemId = body?.item_id as string | undefined;
  if (itemId && (webhookCode === "SYNC_UPDATES_AVAILABLE" || webhookCode === "DEFAULT_UPDATE")) {
    return { kind: "transactions-changed", connectionExternalId: itemId };
  }

  return { kind: "ignored" };
}

export const plaidProvider: BankProvider = {
  id: "plaid",

  isConfigured() {
    return !!env.PLAID_CLIENT_ID && !!env.PLAID_SECRET;
  },

  async createLinkSession(params: CreateLinkSessionParams): Promise<LinkSession> {
    // Offer the institutions of the country the user actually banks in,
    // bounded by what this Plaid account is enabled for.
    const countryCodes = countryCodesForCurrency(
      params.currency,
      parseEnabledCountries(env.PLAID_COUNTRY_CODES)
    );

    const data = await plaid<{
      link_token: string;
      expiration: string;
      hosted_link_url?: string;
    }>("/link/token/create", {
      user: { client_user_id: params.userId },
      client_name: "Real Budget",
      products: ["transactions"],
      country_codes: countryCodes,
      language: "en",
      webhook: params.webhookUrl,
      // Hosted Link lets the app open bank login in a browser (expo-web-browser)
      // without bundling the native Plaid Link SDK. Completion arrives via the
      // SESSION_FINISHED webhook.
      hosted_link: {},
    });

    return {
      linkToken: data.link_token,
      hostedUrl: data.hosted_link_url ?? null,
      expiresAt: data.expiration ?? null,
    };
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
        const inst = await plaid<{ institution: { name: string } }>(
          "/institutions/get_by_id",
          {
            institution_id: institutionId,
            country_codes: parseEnabledCountries(env.PLAID_COUNTRY_CODES),
          }
        );
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
    const data = await plaid<{ accounts: any[] }>("/accounts/get", {
      access_token: accessToken,
    });
    return (data.accounts ?? []).map(toProviderAccount);
  },

  async syncTransactions(accessToken: string, cursor?: string): Promise<TransactionPage> {
    const page = await plaid<{
      added: any[];
      modified: any[];
      removed: Array<{ transaction_id: string }>;
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", { access_token: accessToken, cursor });

    return {
      added: (page.added ?? []).map(toProviderTransaction),
      modified: (page.modified ?? []).map(toProviderTransaction),
      removedExternalIds: (page.removed ?? []).map((r) => r.transaction_id),
      cursor: page.next_cursor,
      hasMore: page.has_more,
    };
  },

  async removeConnection(accessToken: string): Promise<void> {
    await plaid("/item/remove", { access_token: accessToken });
  },

  async verifyWebhook(
    header: (name: string) => string | undefined,
    rawBody: string
  ): Promise<WebhookVerification> {
    return verifyPlaidWebhook(header("Plaid-Verification"), rawBody, {
      getKey: getVerificationKey,
    });
  },

  parseWebhook(body: unknown): WebhookEvent {
    return toWebhookEvent(body);
  },
};
