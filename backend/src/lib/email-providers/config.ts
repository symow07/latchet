/**
 * Which mailbox providers this server can use, from the environment. Kept as
 * plain data so routes, the sync and tests can be handed any configuration.
 */

import type { Env } from "../../env";

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface EmailConfig {
  /** This server's public base URL, no trailing slash: the OAuth redirect URIs hang off it. */
  backendUrl: string;
  production: boolean;
  google: OAuthClient | null;
  microsoft: (OAuthClient & { tenant: string }) | null;
  /** GOOGLE_OAUTH_VERIFIED: Google verified the app, so our own user cap is lifted. */
  gmailVerified: boolean;
  /** Our own count of lifetime Gmail users, matching Google's cap for an unverified app. */
  gmailUserCap: number;
  /** How often the background job syncs each inbox while the server is awake. */
  syncIntervalMinutes: number;
  /** Development and tests only: provider calls go to this fake instead. Null in production. */
  providerBaseOverride: string | null;
  /** The optional AI fallback for mail the rules cannot read. */
  openAiKey: string | null;
  /** Forwarding: the receiving domain and the worker's shared secret. */
  inbound: { domain: string; secret: string } | null;
}

type EmailEnv = Pick<
  Env,
  | "BACKEND_URL"
  | "NODE_ENV"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "GOOGLE_OAUTH_VERIFIED"
  | "GMAIL_USER_CAP"
  | "MICROSOFT_CLIENT_ID"
  | "MICROSOFT_CLIENT_SECRET"
  | "MICROSOFT_TENANT"
  | "EMAIL_SYNC_INTERVAL_MINUTES"
  | "EMAIL_PROVIDER_BASE_OVERRIDE"
  | "OPENAI_API_KEY"
  | "INBOUND_EMAIL_DOMAIN"
  | "INBOUND_EMAIL_SECRET"
>;

const present = (v: string | undefined | null): v is string => typeof v === "string" && v.trim() !== "";

export function emailConfigFrom(e: EmailEnv): EmailConfig {
  const production = e.NODE_ENV === "production";
  return {
    backendUrl: e.BACKEND_URL.replace(/\/+$/, ""),
    production,
    google: present(e.GOOGLE_CLIENT_ID) && present(e.GOOGLE_CLIENT_SECRET)
      ? { clientId: e.GOOGLE_CLIENT_ID.trim(), clientSecret: e.GOOGLE_CLIENT_SECRET.trim() }
      : null,
    microsoft: present(e.MICROSOFT_CLIENT_ID) && present(e.MICROSOFT_CLIENT_SECRET)
      ? {
          clientId: e.MICROSOFT_CLIENT_ID.trim(),
          clientSecret: e.MICROSOFT_CLIENT_SECRET.trim(),
          tenant: present(e.MICROSOFT_TENANT) ? e.MICROSOFT_TENANT.trim() : "consumers",
        }
      : null,
    gmailVerified: e.GOOGLE_OAUTH_VERIFIED === "true",
    gmailUserCap: Number(e.GMAIL_USER_CAP) || 100,
    syncIntervalMinutes: Math.max(5, Number(e.EMAIL_SYNC_INTERVAL_MINUTES) || 60),
    providerBaseOverride: !production && present(e.EMAIL_PROVIDER_BASE_OVERRIDE) ? e.EMAIL_PROVIDER_BASE_OVERRIDE : null,
    openAiKey: present(e.OPENAI_API_KEY) ? e.OPENAI_API_KEY : null,
    inbound: present(e.INBOUND_EMAIL_DOMAIN) && present(e.INBOUND_EMAIL_SECRET)
      ? { domain: e.INBOUND_EMAIL_DOMAIN.trim().toLowerCase(), secret: e.INBOUND_EMAIL_SECRET }
      : null,
  };
}

/** The OAuth redirect URI registered with each provider. */
export function redirectUriFor(config: Pick<EmailConfig, "backendUrl">, provider: "gmail" | "outlook"): string {
  return `${config.backendUrl}/api/v1/email/oauth/${provider}/callback`;
}
