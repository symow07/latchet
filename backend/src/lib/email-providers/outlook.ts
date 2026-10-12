/**
 * Outlook.com and Hotmail mailboxes over Microsoft Graph, for personal
 * accounts: the Microsoft identity platform's v2 endpoints on the configured
 * tenant ("consumers" by default), scopes `openid email offline_access
 * Mail.Read` and nothing broader.
 *
 * Graph has no search we can combine with a date filter, so a listing pages
 * through every message received since the window opened, headers only
 * (id, subject, from, receivedDateTime), and keeps those the parser's header
 * prefilter calls billing; each kept message is downloaded whole as MIME
 * (`$value`). Ids are requested immutable, so a message moved between folders
 * keeps the id its finding was keyed by.
 *
 * Microsoft has no per-app revocation a server can call for personal
 * accounts: disconnecting deletes the token, and the user removes the consent
 * at account.live.com.
 */

import { looksLikeBilling } from "../email-parse";
import type { OAuthClient } from "./config";
import { apiError, callWithRetry, okJson, readBounded, readTokenResponse, scopeSet, type ProviderHttp } from "./http";
import { MAX_MESSAGE_BYTES } from "./limits";
import { MailboxUnavailableError, type ListPage, type MailProvider, type RevokeResult, type TokenGrant } from "./types";

export const OUTLOOK_SCOPES = ["openid", "email", "offline_access", "Mail.Read"] as const;
const GRAPH = "https://graph.microsoft.com/v1.0";
/** Where a personal Microsoft account removes an app's access by hand. */
export const MICROSOFT_MANUAL_REVOKE_URL = "https://account.live.com/consent/Manage";
const PAGE_SIZE = 250;
const IMMUTABLE_IDS = { Prefer: 'IdType="ImmutableId"' };

const ADDRESS_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The claims of a JWT, unverified: only for a token the token endpoint itself just handed us over TLS. */
export function jwtClaims(token: string | null): Record<string, unknown> | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A Graph nextLink is followed only on Graph itself: the access token goes with it. */
function isGraphLink(url: string): boolean {
  return url.startsWith(`${GRAPH}/`);
}

export function outlookProvider(client: OAuthClient & { tenant: string }, http: ProviderHttp): MailProvider {
  const base = `https://login.microsoftonline.com/${encodeURIComponent(client.tenant)}/oauth2/v2.0`;
  const scope = OUTLOOK_SCOPES.join(" ");
  const auth = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/json", ...IMMUTABLE_IDS });

  async function token(form: Record<string, string>): Promise<TokenGrant> {
    const res = await callWithRetry(http, `${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    const t = await readTokenResponse(res);
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, scope: t.scope ?? null, idToken: t.id_token ?? null };
  }

  return {
    name: "outlook",

    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const params = new URLSearchParams({
        client_id: client.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return `${base}/authorize?${params.toString()}`;
    },

    exchangeCode({ code, codeVerifier, redirectUri }) {
      return token({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
        scope,
      });
    },

    refresh(refreshToken) {
      return token({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope,
      });
    },

    grantsMailRead(granted) {
      if (granted === null) return true;
      return [...scopeSet(granted)].some((s) => /(?:^|\/)mail\.read$/i.test(s));
    },

    async mailboxAddress(grant) {
      const claims = jwtClaims(grant.idToken);
      const aud = claims?.aud;
      if (claims && (aud === undefined || aud === client.clientId)) {
        for (const c of [claims.email, claims.preferred_username]) {
          const v = typeof c === "string" ? c.trim().toLowerCase() : "";
          if (ADDRESS_RE.test(v)) return v;
        }
      }
      const res = await callWithRetry(http, `${GRAPH}/me?$select=mail,userPrincipalName`, { headers: auth(grant.accessToken) });
      if (!res.ok) throw await apiError(res);
      const me = await okJson<{ mail?: unknown; userPrincipalName?: unknown }>(res);
      for (const c of [me.mail, me.userPrincipalName]) {
        const v = typeof c === "string" ? c.trim().toLowerCase() : "";
        if (ADDRESS_RE.test(v)) return v;
      }
      throw new MailboxUnavailableError();
    },

    async listPage(accessToken, q): Promise<ListPage> {
      let url: string;
      if (q.cursor && isGraphLink(q.cursor)) {
        url = q.cursor;
      } else {
        const since = new Date(q.sinceMs).toISOString();
        url =
          `${GRAPH}/me/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` +
          `&$select=${encodeURIComponent("id,subject,from,receivedDateTime")}` +
          `&$orderby=${encodeURIComponent("receivedDateTime desc")}&$top=${PAGE_SIZE}`;
      }
      const res = await callWithRetry(http, url, { headers: auth(accessToken) });
      if (!res.ok) throw await apiError(res);
      const j = await okJson<{ value?: unknown[]; "@odata.nextLink"?: unknown }>(res);
      const value = Array.isArray(j.value) ? j.value : [];
      const ids: string[] = [];
      for (const item of value) {
        const m = item as { id?: unknown; subject?: unknown; from?: { emailAddress?: { name?: unknown; address?: unknown } } };
        if (typeof m.id !== "string" || !m.id) continue;
        const name = typeof m.from?.emailAddress?.name === "string" ? m.from.emailAddress.name : "";
        const address = typeof m.from?.emailAddress?.address === "string" ? m.from.emailAddress.address : "";
        const subject = typeof m.subject === "string" ? m.subject : "";
        if (looksLikeBilling({ from: `${name} <${address}>`, subject })) ids.push(m.id);
      }
      const nextLink = j["@odata.nextLink"];
      const next = typeof nextLink === "string" && isGraphLink(nextLink) ? nextLink : null;
      return { ids, listed: value.length, next };
    },

    async fetchRaw(accessToken, id) {
      const res = await callWithRetry(http, `${GRAPH}/me/messages/${encodeURIComponent(id)}/$value`, {
        headers: { ...auth(accessToken), Accept: "message/rfc822, text/plain, */*" },
        timeoutMs: 30_000,
      });
      if (res.status === 404 || res.status === 400) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      if (!res.ok) throw await apiError(res);
      return readBounded(res, MAX_MESSAGE_BYTES);
    },

    async revoke(): Promise<RevokeResult> {
      return { revoked: false, manualRevokeUrl: MICROSOFT_MANUAL_REVOKE_URL };
    },
  };
}
