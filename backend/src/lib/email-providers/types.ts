/**
 * Inbox reading over OAuth (I-EMAIL-API, .unlazy/phase6/PLAN.md): the shape
 * every mailbox provider has, so the routes and the sync treat Gmail and
 * Outlook alike.
 *
 * Nothing in this directory logs mail text, subjects, addresses, tokens or
 * provider message ids; errors carry short codes only.
 */

import type { TimeoutInit } from "../fetch-timeout";

export type ProviderName = "gmail" | "outlook";
export const PROVIDER_NAMES: readonly ProviderName[] = ["gmail", "outlook"];

/** fetchWithTimeout's signature; tests pass a fake. */
export type FetchFn = (url: string, init?: TimeoutInit) => Promise<Response>;

/** What a token endpoint answered, reduced to what we use. */
export interface TokenGrant {
  accessToken: string;
  /** A new refresh token: on the first exchange, and when Microsoft rotates it. */
  refreshToken: string | null;
  /** The scopes actually granted, space separated, as the provider reports them. */
  scope: string | null;
  /** Microsoft's ID token (the mailbox address is in it). Never stored. */
  idToken: string | null;
}

/** One page of a mailbox listing. */
export interface ListPage {
  /** Message ids worth downloading in full (Outlook prefilters on headers). */
  ids: string[];
  /** How many messages the page listed, before any prefilter. */
  listed: number;
  /** Opaque cursor for the next page; null when the listing is done. */
  next: string | null;
}

export interface ListQuery {
  /** The one-year backfill, or an incremental pass. */
  backfill: boolean;
  /** Mail received at or after this instant (epoch ms). */
  sinceMs: number;
  /** The cursor a previous page returned; null to start. */
  cursor: string | null;
}

/** Revoking a grant: done, or only the user can do it, here. */
export type RevokeResult = { revoked: true } | { revoked: false; manualRevokeUrl: string };

export interface MailProvider {
  readonly name: ProviderName;
  /** Where the user's browser goes to consent. */
  authorizeUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenGrant>;
  refresh(refreshToken: string): Promise<TokenGrant>;
  /** Whether the granted scopes include mail reading (the user may untick it). */
  grantsMailRead(scope: string | null): boolean;
  /** The mailbox's address, lower-case. */
  mailboxAddress(grant: TokenGrant): Promise<string>;
  listPage(accessToken: string, q: ListQuery): Promise<ListPage>;
  /** The whole message as MIME bytes; null when it is gone or too large to read. */
  fetchRaw(accessToken: string, id: string): Promise<Uint8Array | null>;
  revoke(refreshToken: string): Promise<RevokeResult>;
}

export type ProviderSet = Partial<Record<ProviderName, MailProvider | null>>;

/** Encrypts refresh tokens at rest (lib/crypto by default). */
export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

// ── Errors: short codes, never provider text ────────────────────────────────

/** Base class: `code` is what may be stored (lastError) or shown in a redirect. */
export class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProviderError";
  }
}

/** The grant is gone (invalid_grant, revoked, scope removed): the user must reconnect. */
export class ReauthRequiredError extends ProviderError {
  constructor() {
    super("reauth_required");
    this.name = "ReauthRequiredError";
  }
}

/** The access token expired or was refused (HTTP 401): refresh and retry once. */
export class AccessExpiredError extends ProviderError {
  constructor() {
    super("access_expired");
    this.name = "AccessExpiredError";
  }
}

/** Throttled or temporarily down after retries: try again on the next sync. */
export class ProviderBusyError extends ProviderError {
  constructor() {
    super("provider_busy");
    this.name = "ProviderBusyError";
  }
}

/** The account has no mailbox this API can read (e.g. a Google account without Gmail). */
export class MailboxUnavailableError extends ProviderError {
  constructor() {
    super("mailbox_unavailable");
    this.name = "MailboxUnavailableError";
  }
}
