/**
 * The OAuth handshake's shared state, in Postgres so the callback can land on
 * any instance: a pending connect (who started it, for which provider, the
 * PKCE verifier and where to send the browser back) kept for ten minutes in
 * CacheEntry and consumed atomically, so a replayed callback finds nothing.
 *
 * Also the Gmail user ledger: Google caps an unverified app at 100 users over
 * its lifetime, so we count every user who ever granted Gmail access
 * (EmailOAuthGrant, keyed by a hash of the user id, kept after the account is
 * gone) and refuse new ones at the cap until GOOGLE_OAUTH_VERIFIED is set.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../prisma";
import { cacheSet, cacheTake } from "../distributed/cache";
import type { Db } from "../distributed/clock";
import type { EmailConfig } from "./config";
import type { ProviderName } from "./types";

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** Where the browser goes when the state is unknown, so the app still hears the outcome. */
export const DEFAULT_RETURN_URL = "latchet://email/connected";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer) => b.toString("base64url");

export function newOAuthState(): string {
  return b64url(randomBytes(32));
}

/** RFC 7636: 32 random bytes, base64url (43 characters). */
export function newCodeVerifier(): string {
  return b64url(randomBytes(32));
}

/** The S256 challenge for a verifier. */
export function codeChallengeFor(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export interface PendingConnect {
  userId: string;
  provider: ProviderName;
  codeVerifier: string;
  returnUrl: string;
}

/** The state travels through the browser; the key holds only its digest. */
const stateKey = (state: string) => `email-oauth:${sha256(state)}`;

export async function rememberConnect(state: string, pending: PendingConnect, db?: Db): Promise<void> {
  await cacheSet(stateKey(state), pending, OAUTH_STATE_TTL_MS, db);
}

/** The pending connect `state` names, consumed: a second call anywhere gets null. */
export async function takeConnect(state: string, db?: Db): Promise<PendingConnect | null> {
  if (!state || state.length > 200) return null;
  const v = await cacheTake<PendingConnect>(stateKey(state), db);
  if (!v || typeof v.userId !== "string" || typeof v.codeVerifier !== "string") return null;
  return v;
}

/**
 * Where the browser may be sent back to: the app's own scheme, and outside
 * production Expo Go's and the development client's.
 */
export function isAllowedReturnUrl(url: string, production: boolean): boolean {
  if (url.length > 500 || /[\s<>"]/.test(url)) return false;
  if (/^latchet:\/\//.test(url)) return true;
  return !production && /^exp(?:\+[a-z0-9-]+)?:\/\/\S+$/i.test(url);
}

/** `url` with `params` appended, whatever query it already has. */
export function withQuery(url: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

// ── The Gmail user ledger ────────────────────────────────────────────────────

/** How a user is named in the ledger: a digest that identifies nobody once the account is gone. */
export function userKeyFor(userId: string): string {
  return sha256(userId);
}

export interface GmailCap {
  /** This user granted Gmail access before (so may always reconnect). */
  counted: boolean;
  /** Users who ever granted Gmail access. */
  count: number;
  /** This user cannot start a Gmail connection. */
  capReached: boolean;
}

export async function gmailCapFor(
  userId: string,
  config: Pick<EmailConfig, "gmailVerified" | "gmailUserCap">,
  db: Db = prisma
): Promise<GmailCap> {
  const [mine, count] = await Promise.all([
    db.emailOAuthGrant.findUnique({
      where: { provider_userKey: { provider: "gmail", userKey: userKeyFor(userId) } },
      select: { id: true },
    }),
    db.emailOAuthGrant.count({ where: { provider: "gmail" } }),
  ]);
  const counted = mine !== null;
  return { counted, count, capReached: !config.gmailVerified && !counted && count >= config.gmailUserCap };
}

/** Count `userId` as a user of `provider`, once for life. */
export async function recordGrant(provider: ProviderName, userId: string, db: Db = prisma): Promise<void> {
  await db.emailOAuthGrant.createMany({
    data: [{ provider, userKey: userKeyFor(userId) }],
    skipDuplicates: true,
  });
}
