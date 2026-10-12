/**
 * Gmail over its REST API, with the restricted gmail.readonly scope and
 * nothing else (the address comes from users/me/profile, so no openid/email).
 *
 * Finding billing mail: one search per group of the parser's multilingual
 * BILLING_TERMS, each kept short (Gmail mishandles very long queries), with
 * `category:purchases` in the first. The backfill searches `newer_than:1y`;
 * an incremental pass searches `after:<epoch seconds>`. Each hit is downloaded
 * whole (format=raw) and handed to the MIME parser — never the snippet.
 */

import { BILLING_TERMS } from "../email-parse";
import type { OAuthClient } from "./config";
import {
  apiError,
  callWithRetry,
  okJson,
  readBounded,
  readTokenResponse,
  scopeSet,
  type ProviderHttp,
} from "./http";
import { MAX_MESSAGE_BYTES } from "./limits";
import {
  MailboxUnavailableError,
  ProviderError,
  type ListPage,
  type ListQuery,
  type MailProvider,
  type RevokeResult,
  type TokenGrant,
} from "./types";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Where a user removes Budget's access to their Google account by hand. */
export const GOOGLE_MANUAL_REVOKE_URL = "https://myaccount.google.com/permissions";

/** Characters of search terms per query. Gmail rejects or truncates long ones. */
const QUERY_TERMS_MAX = 450;
const PAGE_SIZE = 100;

/** A term as Gmail search syntax: bare when it is one word, quoted otherwise. */
function gmailTerm(term: string): string {
  const t = term.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  return /^[\p{L}\p{N}]+$/u.test(t) ? t : `"${t}"`;
}

/**
 * The term part of each search: `subject:(a OR "b c" …)`, split so each stays
 * under QUERY_TERMS_MAX characters. The first also takes Gmail's own
 * purchases category, which catches receipts whose subject names no term.
 */
export function gmailTermClauses(terms: readonly string[] = BILLING_TERMS, max = QUERY_TERMS_MAX): string[] {
  const groups: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const raw of terms) {
    const t = gmailTerm(raw);
    if (!t || t === '""') continue;
    if (current.length && length + t.length + 4 > max) {
      groups.push(current);
      current = [];
      length = 0;
    }
    current.push(t);
    length += t.length + 4;
  }
  if (current.length) groups.push(current);
  return groups.map((g, i) => {
    const subject = `subject:(${g.join(" OR ")})`;
    return i === 0 ? `(category:purchases OR ${subject})` : subject;
  });
}

/** The full search for one clause: the time window, the size bound, the terms. */
export function gmailQuery(clause: string, q: Pick<ListQuery, "backfill" | "sinceMs">): string {
  const when = q.backfill ? "newer_than:1y" : `after:${Math.floor(q.sinceMs / 1000)}`;
  const sizeMb = Math.floor(MAX_MESSAGE_BYTES / (1024 * 1024));
  return `${when} smaller:${sizeMb}M ${clause}`;
}

interface GmailCursor {
  /** Which term clause. */
  c: number;
  /** Gmail's page token within it. */
  p: string | null;
}

function parseCursor(cursor: string | null): GmailCursor {
  if (!cursor) return { c: 0, p: null };
  try {
    const j = JSON.parse(cursor) as GmailCursor;
    if (Number.isInteger(j.c) && j.c >= 0 && (j.p === null || typeof j.p === "string")) return j;
  } catch {
    /* a cursor from an older format restarts the listing; duplicates are skipped */
  }
  return { c: 0, p: null };
}

const ADDRESS_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Revoke a Google token, and with it the user's whole grant to this app.
 * Needs no client credentials, so it works even after the client is removed.
 * A token Google no longer knows (revoked from the user's account page,
 * expired) counts as revoked.
 */
export async function revokeGoogleToken(http: ProviderHttp, token: string): Promise<RevokeResult> {
  const res = await callWithRetry(http, GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  if (res.ok) {
    await res.body?.cancel().catch(() => {});
    return { revoked: true };
  }
  const text = await res.text().catch(() => "");
  if (res.status === 400 && /invalid_token/.test(text)) return { revoked: true };
  throw new ProviderError("revoke_failed");
}

export function gmailProvider(client: OAuthClient, http: ProviderHttp): MailProvider {
  const auth = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });
  const clauses = gmailTermClauses();

  async function token(form: Record<string, string>): Promise<TokenGrant> {
    const res = await callWithRetry(http, GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    const t = await readTokenResponse(res);
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, scope: t.scope ?? null, idToken: t.id_token ?? null };
  }

  return {
    name: "gmail",

    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GMAIL_SCOPE,
        // A refresh token, and on every consent: without prompt=consent a
        // returning user's grant comes back with none.
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    },

    exchangeCode({ code, codeVerifier, redirectUri }) {
      return token({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      });
    },

    refresh(refreshToken) {
      return token({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
    },

    grantsMailRead(scope) {
      // Google's consent screen lets the user untick the Gmail box.
      if (scope === null) return true;
      const granted = scopeSet(scope);
      return granted.has(GMAIL_SCOPE) || granted.has("https://mail.google.com/");
    },

    async mailboxAddress(grant) {
      const res = await callWithRetry(http, `${GMAIL_API}/profile`, { headers: auth(grant.accessToken) });
      if (!res.ok) throw await apiError(res);
      const j = await okJson<{ emailAddress?: unknown }>(res);
      const address = typeof j.emailAddress === "string" ? j.emailAddress.trim().toLowerCase() : "";
      if (!ADDRESS_RE.test(address)) throw new MailboxUnavailableError();
      return address;
    },

    async listPage(accessToken, q): Promise<ListPage> {
      const cur = parseCursor(q.cursor);
      const clause = clauses[cur.c];
      if (clause === undefined) return { ids: [], listed: 0, next: null };
      const params = new URLSearchParams({ q: gmailQuery(clause, q), maxResults: String(PAGE_SIZE) });
      if (cur.p) params.set("pageToken", cur.p);
      const res = await callWithRetry(http, `${GMAIL_API}/messages?${params.toString()}`, { headers: auth(accessToken) });
      if (!res.ok) throw await apiError(res);
      const j = await okJson<{ messages?: { id?: unknown }[]; nextPageToken?: unknown }>(res);
      const ids = (j.messages ?? []).map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length > 0);
      let next: GmailCursor | null = null;
      if (typeof j.nextPageToken === "string" && j.nextPageToken) next = { c: cur.c, p: j.nextPageToken };
      else if (cur.c + 1 < clauses.length) next = { c: cur.c + 1, p: null };
      return { ids, listed: ids.length, next: next ? JSON.stringify(next) : null };
    },

    async fetchRaw(accessToken, id) {
      const res = await callWithRetry(http, `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=raw`, {
        headers: auth(accessToken),
        timeoutMs: 30_000,
      });
      // Deleted between the listing and now, or an id Gmail no longer knows.
      if (res.status === 404 || res.status === 400) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      if (!res.ok) throw await apiError(res);
      // base64url inflates by a third; the JSON around it is small.
      const body = await readBounded(res, Math.ceil((MAX_MESSAGE_BYTES * 4) / 3) + 64 * 1024);
      if (!body) return null;
      let raw: unknown;
      try {
        raw = (JSON.parse(new TextDecoder().decode(body)) as { raw?: unknown }).raw;
      } catch {
        throw new ProviderError("provider_error");
      }
      if (typeof raw !== "string" || !raw) return null;
      const bytes = Buffer.from(raw, "base64url");
      if (bytes.byteLength > MAX_MESSAGE_BYTES) return null;
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },

    revoke(refreshToken) {
      return revokeGoogleToken(http, refreshToken);
    },
  };
}

