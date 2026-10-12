/**
 * An in-process fake Google (OAuth + Gmail) and Microsoft (OAuth + Graph) for
 * the inbox tests, reached through the same override the development server
 * uses: `https://<host><path>` → `http://fake/<host><path>`. Every API call
 * must carry an access token the fake issued, so code that skips the token
 * exchange or the refresh fails.
 *
 * Mailboxes are keyed by the authorization code a test hands the callback.
 * Imported only by tests.
 */

import { prisma } from "../../prisma";
import type { TimeoutInit } from "../fetch-timeout";
import type { EmailConfig } from "./config";
import { mail, multipart, text } from "../email-parse/test-utils";
import { providerHttp, type ProviderHttp } from "./http";
import type { FetchFn } from "./types";

export const FAKE_BASE = "http://fake";

export interface FakeMessage {
  id: string;
  raw: Uint8Array;
  /** Epoch ms. */
  internalDate: number;
  /** Decoded, as the APIs report them. */
  from: string;
  subject: string;
}

export interface FakeMailbox {
  gmailAddress?: string;
  outlookAddress?: string;
  gmail: FakeMessage[];
  outlook: FakeMessage[];
}

export interface FakeLog {
  requests: string[];
  gmailQueries: string[];
  graphUrls: string[];
  /** Ids downloaded whole, with the format/endpoint used. */
  rawFetches: string[];
  googleRevoked: string[];
  tokenForms: Record<string, string>[];
  unauthorized: number;
  /** Headers of every Graph call. */
  graphHeaders: Record<string, string>[];
}

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");
export const fakeJwt = (payload: Record<string, unknown>) =>
  `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.sig`;

export interface FakeProviders {
  fetch: FetchFn;
  http: ProviderHttp;
  log: FakeLog;
  mailboxes: Record<string, FakeMailbox>;
  /** Make every refresh token of `code` invalid (the user revoked access). */
  revokeAll(code: string): void;
  /** Make every access token invalid (they expired). */
  expireAccessTokens(): void;
  /** Answer the next request whose path matches with `status` (once each). */
  failNext(match: RegExp, status: number, times?: number): void;
  /** Hold every Gmail/Graph listing until `release` is called. */
  holdListings(): { release: () => void };
  /** Pages: Gmail list page size, Graph page size. */
  pageSize: { gmail: number; graph: number };
  /** Whether the ID token carries the address (else Graph /me must be asked). */
  idTokenHasEmail: boolean;
  /** Scope Google reports granted (a user can untick Gmail on the consent screen). */
  googleScope: string;
}

export function startFake(mailboxes: Record<string, FakeMailbox>): FakeProviders {
  const log: FakeLog = { requests: [], gmailQueries: [], graphUrls: [], rawFetches: [], googleRevoked: [], tokenForms: [], unauthorized: 0, graphHeaders: [] };
  const refreshToBox = new Map<string, { code: string; provider: "google" | "microsoft" }>();
  const accessToBox = new Map<string, { code: string; provider: "google" | "microsoft" }>();
  const failures: { match: RegExp; status: number; times: number }[] = [];
  let hold: Promise<void> | null = null;
  let n = 0;

  const issue = (code: string, provider: "google" | "microsoft") => {
    n += 1;
    const p = provider === "google" ? "g" : "m";
    const refresh = `${p}-refresh-${code}-${n}`;
    const access = `${p}-access-${code}-${n}`;
    refreshToBox.set(refresh, { code, provider });
    accessToBox.set(access, { code, provider });
    return { refresh, access };
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const self: FakeProviders = {
    fetch: null as unknown as FetchFn,
    http: null as unknown as ProviderHttp,
    log,
    mailboxes,
    pageSize: { gmail: 3, graph: 2 },
    idTokenHasEmail: true,
    googleScope: "https://www.googleapis.com/auth/gmail.readonly",
    revokeAll(code) {
      for (const [k, v] of refreshToBox) if (v.code === code) refreshToBox.delete(k);
      for (const [k, v] of accessToBox) if (v.code === code) accessToBox.delete(k);
    },
    expireAccessTokens() {
      accessToBox.clear();
    },
    failNext(match, status, times = 1) {
      failures.push({ match, status, times });
    },
    holdListings() {
      let release!: () => void;
      hold = new Promise<void>((r) => (release = r));
      return { release: () => { hold = null; release(); } };
    },
  };

  const auth = (req: Request, provider: "google" | "microsoft") => {
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
    const box = m ? accessToBox.get(m[1]!) : undefined;
    if (!box || box.provider !== provider) {
      log.unauthorized += 1;
      return null;
    }
    return mailboxes[box.code] ?? null;
  };
  const gmailFilter = (q: string, msgs: FakeMessage[]) => {
    let min = -Infinity;
    const now = Date.now();
    for (const [, num, unit] of q.matchAll(/newer_than:(\d+)([dmy])/g)) {
      const days = Number(num) * (unit === "d" ? 1 : unit === "m" ? 31 : 366);
      min = Math.max(min, now - days * 86_400_000);
    }
    for (const [, v] of q.matchAll(/\bafter:(\d+)/g)) min = Math.max(min, Number(v) * 1000);
    return msgs.filter((m) => m.internalDate >= min);
  };

  async function handle(url: URL, init: TimeoutInit): Promise<Response> {
    const req = new Request(url.toString(), init as RequestInit);
    const [, host, ...rest] = url.pathname.split("/");
    const p = "/" + rest.join("/");
    log.requests.push(`${req.method} ${host}${p}`);
    const failure = failures.find((f) => f.match.test(`${host}${p}`) && f.times > 0);
    if (failure) {
      failure.times -= 1;
      return json(failure.status, { error: { code: failure.status, message: "injected" } });
    }
    const body = req.method === "POST" ? await req.text() : "";
    const form = new URLSearchParams(body);

    if (host === "oauth2.googleapis.com" && p === "/token") {
      log.tokenForms.push(Object.fromEntries(form));
      if (form.get("grant_type") === "authorization_code") {
        const code = form.get("code") ?? "";
        if (!mailboxes[code] || !form.get("client_secret") || !form.get("redirect_uri") || !form.get("code_verifier")) return json(400, { error: "invalid_grant" });
        const t = issue(code, "google");
        return json(200, { access_token: t.access, refresh_token: t.refresh, expires_in: 3599, token_type: "Bearer", scope: self.googleScope });
      }
      if (form.get("grant_type") === "refresh_token") {
        const box = refreshToBox.get(form.get("refresh_token") ?? "");
        if (!box || box.provider !== "google") return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        n += 1;
        const access = `g-access-${box.code}-${n}`;
        accessToBox.set(access, box);
        return json(200, { access_token: access, expires_in: 3599, token_type: "Bearer", scope: self.googleScope });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (host === "oauth2.googleapis.com" && p === "/revoke") {
      const token = form.get("token") ?? "";
      log.googleRevoked.push(token);
      const known = refreshToBox.has(token);
      refreshToBox.delete(token);
      return known ? new Response(null, { status: 200 }) : json(400, { error: "invalid_token" });
    }
    if (host === "gmail.googleapis.com") {
      const box = auth(req, "google");
      if (!box) return json(401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
      if (p === "/gmail/v1/users/me/profile") return json(200, { emailAddress: box.gmailAddress, historyId: "1" });
      if (p === "/gmail/v1/users/me/messages") {
        if (hold) await hold;
        const q = url.searchParams.get("q") ?? "";
        log.gmailQueries.push(q);
        const all = gmailFilter(q, box.gmail).sort((a, b) => b.internalDate - a.internalDate);
        const start = Number(url.searchParams.get("pageToken") || 0);
        const page = all.slice(start, start + self.pageSize.gmail);
        const out: Record<string, unknown> = { resultSizeEstimate: all.length };
        if (page.length) out.messages = page.map((m) => ({ id: m.id, threadId: `t${m.id}` }));
        if (start + self.pageSize.gmail < all.length) out.nextPageToken = String(start + self.pageSize.gmail);
        return json(200, out);
      }
      const mm = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(p);
      if (mm) {
        const m = box.gmail.find((x) => x.id === decodeURIComponent(mm[1]!));
        if (!m) return json(404, { error: { code: 404, message: "Requested entity was not found." } });
        const format = url.searchParams.get("format") ?? "full";
        log.rawFetches.push(`gmail:${m.id}:${format}`);
        if (format === "raw") return json(200, { id: m.id, sizeEstimate: m.raw.byteLength, raw: b64url(m.raw) });
        // The snippet a lazy reader would settle for: never enough to read a bill.
        return json(200, { id: m.id, snippet: m.subject, payload: { headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }] } });
      }
      return json(404, { error: { code: 404, message: "not found" } });
    }
    if (host === "login.microsoftonline.com" && /\/oauth2\/v2\.0\/token$/.test(p)) {
      log.tokenForms.push({ ...Object.fromEntries(form), tenant: p.split("/")[1] ?? "" });
      if (form.get("grant_type") === "authorization_code") {
        const code = form.get("code") ?? "";
        if (!mailboxes[code] || !form.get("client_id") || !form.get("redirect_uri") || !form.get("code_verifier")) return json(400, { error: "invalid_grant" });
        const t = issue(code, "microsoft");
        const addr = mailboxes[code]!.outlookAddress;
        const claims = self.idTokenHasEmail ? { email: addr, preferred_username: addr, aud: "fake-ms-client" } : { aud: "fake-ms-client", preferred_username: "+15551234567" };
        return json(200, { access_token: t.access, refresh_token: t.refresh, expires_in: 3600, token_type: "Bearer", scope: "Mail.Read openid email offline_access", id_token: fakeJwt(claims) });
      }
      if (form.get("grant_type") === "refresh_token") {
        const old = form.get("refresh_token") ?? "";
        const box = refreshToBox.get(old);
        if (!box || box.provider !== "microsoft") return json(400, { error: "invalid_grant" });
        // Microsoft rotates: the old refresh token stops working.
        refreshToBox.delete(old);
        const t = issue(box.code, "microsoft");
        return json(200, { access_token: t.access, refresh_token: t.refresh, expires_in: 3600, token_type: "Bearer", scope: "Mail.Read" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (host === "graph.microsoft.com") {
      log.graphHeaders.push(Object.fromEntries(req.headers));
      const box = auth(req, "microsoft");
      if (!box) return json(401, { error: { code: "InvalidAuthenticationToken", message: "Access token is empty." } });
      if (p === "/v1.0/me") return json(200, { mail: null, userPrincipalName: box.outlookAddress });
      if (p === "/v1.0/me/messages") {
        if (hold) await hold;
        log.graphUrls.push(url.search);
        let msgs = [...box.outlook];
        const filter = url.searchParams.get("$filter") ?? "";
        const ge = /receivedDateTime\s+ge\s+([0-9TZ:.\-]+)/i.exec(filter);
        if (ge) msgs = msgs.filter((m) => m.internalDate >= Date.parse(ge[1]!));
        msgs.sort((a, b) => b.internalDate - a.internalDate);
        const skip = Number(url.searchParams.get("$skiptoken") || 0);
        const top = Math.min(Number(url.searchParams.get("$top") || 10), self.pageSize.graph);
        const page = msgs.slice(skip, skip + top);
        const out: Record<string, unknown> = {
          value: page.map((m) => ({
            id: m.id,
            subject: m.subject,
            receivedDateTime: new Date(m.internalDate).toISOString(),
            from: { emailAddress: { name: m.from.replace(/\s*<.*$/, ""), address: (/<([^>]+)>/.exec(m.from) ?? [])[1] } },
          })),
        };
        if (skip + top < msgs.length) {
          const next = new URL(`https://graph.microsoft.com${p}`);
          for (const [k, v] of url.searchParams) if (k !== "$skiptoken") next.searchParams.set(k, v);
          next.searchParams.set("$skiptoken", String(skip + top));
          out["@odata.nextLink"] = next.toString();
        }
        return json(200, out);
      }
      const val = /^\/v1\.0\/me\/messages\/([^/]+)\/\$value$/.exec(p);
      if (val) {
        const m = box.outlook.find((x) => x.id === decodeURIComponent(val[1]!));
        if (!m) return json(404, { error: { code: "ErrorItemNotFound" } });
        log.rawFetches.push(`outlook:${m.id}:$value`);
        return new Response(m.raw, { status: 200, headers: { "content-type": "text/plain" } });
      }
      return json(404, { error: { code: "ResourceNotFound" } });
    }
    return json(404, { error: `fake: unknown host ${host}` });
  }

  self.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.origin !== FAKE_BASE) throw new Error(`fake: a request escaped the override: ${url.origin}`);
    return handle(url, init);
  };
  self.http = providerHttp(FAKE_BASE, self.fetch, async () => {});
  return self;
}

// ── Messages ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
let seq = 0;

/** A billing (or not) email as raw MIME, received `daysAgo` days ago. */
export function fakeMessage(
  id: string,
  opts: { daysAgo: number; fromName: string; fromAddress: string; subject: string; body: string; html?: boolean }
): FakeMessage {
  const when = Date.now() - opts.daysAgo * DAY;
  const date = new Date(when).toUTCString();
  const root = opts.html
    ? multipart("alternative", [text("html", `<html><body><p>${opts.body.replace(/\n/g, "</p><p>")}</p></body></html>`)])
    : text("plain", opts.body);
  const raw = mail(
    {
      From: `${opts.fromName} <${opts.fromAddress}>`,
      To: "someone@example.test",
      Subject: opts.subject,
      Date: date,
      "Message-ID": `<fake-${id}-${++seq}@mail.example.test>`,
    },
    root
  );
  return { id, raw, internalDate: when, from: `${opts.fromName} <${opts.fromAddress}>`, subject: opts.subject };
}

/** A renewal whose amount is only in the body. */
export const netflixRenewal = (id: string, daysAgo: number) =>
  fakeMessage(id, {
    daysAgo,
    fromName: "Netflix",
    fromAddress: "info@account.netflix.com",
    subject: "Your Netflix membership has been renewed",
    body: "Hi,\n\nYour Netflix membership has been renewed.\n\nAmount charged: $15.49\nPlan: Standard (monthly)\nNext billing date: the same day next month.\n\nThe Netflix team",
  });

export const spotifyReceipt = (id: string, daysAgo: number) =>
  fakeMessage(id, {
    daysAgo,
    fromName: "Spotify",
    fromAddress: "no-reply@spotify.com",
    subject: "Your Spotify Premium receipt",
    html: true,
    body: "Thanks for your payment.\nSpotify Premium Individual — monthly subscription\nTotal paid: €10.99\nYour plan renews automatically every month.",
  });

export const newsletter = (id: string, daysAgo: number) =>
  fakeMessage(id, {
    daysAgo,
    fromName: "Acme Weekly",
    fromAddress: "news@acmenews.example",
    subject: "This week: 10 gadgets under $50",
    body: "Our favourite gadgets this week, all under $50. Read more on our site.\nUnsubscribe anytime.",
  });

// ── Test users and configuration ─────────────────────────────────────────────


export const TEST_CONFIG: EmailConfig = {
  backendUrl: "http://backend.test",
  production: false,
  google: { clientId: "fake-google-client", clientSecret: "fake-google-secret" },
  microsoft: { clientId: "fake-ms-client", clientSecret: "fake-ms-secret", tenant: "consumers" },
  gmailVerified: false,
  gmailUserCap: 100,
  syncIntervalMinutes: 60,
  providerBaseOverride: FAKE_BASE,
  openAiKey: null,
  inbound: { domain: "in.budget.test", secret: "inbound-secret-for-tests-0123456789" },
};

/** A user row for a test, with an id under `prefix` so cleanup reaches only it. */
export async function testUser(prefix: string, label: string): Promise<{ id: string; email: string }> {
  const id = `${prefix}_${label}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `${id}@x.test`;
  const now = new Date();
  await prisma.user.create({ data: { id, name: label, email, createdAt: now, updatedAt: now } });
  return { id, email };
}

/** Remove a test's users (cascading to their connections and findings). */
export async function cleanupUsers(prefix: string): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { startsWith: `${prefix}_` } } });
}
