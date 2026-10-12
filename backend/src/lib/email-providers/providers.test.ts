import { test, expect } from "bun:test";
import { BILLING_TERMS } from "../email-parse";
import { gmailProvider, gmailQuery, gmailTermClauses, GMAIL_SCOPE } from "./gmail";
import { outlookProvider, jwtClaims, OUTLOOK_SCOPES } from "./outlook";
import { providerUrl, readBounded, callWithRetry, providerHttp } from "./http";
import { codeChallengeFor, newCodeVerifier } from "./oauth";
import { netflixRenewal, newsletter, spotifyReceipt, startFake, TEST_CONFIG } from "./test-fakes";
import { ProviderBusyError } from "./types";

/**
 * The providers on their own, against the in-process fake Google and
 * Microsoft: URLs, scopes, paging, the override, and what is downloaded.
 */

const DAY = 86_400_000;
const google = TEST_CONFIG.google!;
const microsoft = TEST_CONFIG.microsoft!;

test("outlook graph: personal accounts — the consumers tenant, Mail.Read and nothing broader, PKCE S256", async () => {
  const fake = startFake({ codeO: { outlookAddress: "o@outlook.com", gmail: [], outlook: [] } });
  const outlook = outlookProvider(microsoft, fake.http);
  const verifier = newCodeVerifier();
  const url = new URL(outlook.authorizeUrl({ state: "st", codeChallenge: codeChallengeFor(verifier), redirectUri: "http://backend.test/cb" }));
  expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  expect((url.searchParams.get("scope") ?? "").split(" ").sort()).toEqual([...OUTLOOK_SCOPES].sort());
  expect(OUTLOOK_SCOPES).toEqual(["openid", "email", "offline_access", "Mail.Read"]);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBe(codeChallengeFor(verifier));
  expect(url.searchParams.get("response_type")).toBe("code");

  const grant = await outlook.exchangeCode({ code: "codeO", codeVerifier: verifier, redirectUri: "http://backend.test/cb" });
  const form = fake.log.tokenForms.at(-1)!;
  expect(form.tenant).toBe("consumers");
  expect(form.code_verifier).toBe(verifier);
  expect(form.client_secret).toBe(microsoft.clientSecret);
  expect(outlook.grantsMailRead(grant.scope)).toBe(true);
  expect(outlook.grantsMailRead("openid email")).toBe(false);
  expect(outlook.grantsMailRead("https://graph.microsoft.com/Mail.Read offline_access")).toBe(true);
});

test("outlook graph: the address comes from the ID token, and from /me when the token has none", async () => {
  const fake = startFake({ codeO: { outlookAddress: "Someone@Outlook.com", gmail: [], outlook: [] } });
  const outlook = outlookProvider(microsoft, fake.http);
  const grant = await outlook.exchangeCode({ code: "codeO", codeVerifier: "v".repeat(43), redirectUri: "r" });
  expect(await outlook.mailboxAddress(grant)).toBe("someone@outlook.com");
  expect(fake.log.requests.some((r) => r.includes("graph.microsoft.com/v1.0/me"))).toBe(false);

  // A Microsoft account signed in with a phone number: no address in the token.
  fake.idTokenHasEmail = false;
  const grant2 = await outlook.exchangeCode({ code: "codeO", codeVerifier: "v".repeat(43), redirectUri: "r" });
  expect(await outlook.mailboxAddress(grant2)).toBe("someone@outlook.com");
  expect(fake.log.requests.some((r) => r.startsWith("GET graph.microsoft.com/v1.0/me"))).toBe(true);
  expect(jwtClaims("not-a-jwt")).toBeNull();
});

test("outlook graph: a listing follows @odata.nextLink, keeps billing-looking headers only, and asks for immutable ids", async () => {
  const outlookMail = [
    netflixRenewal("o1", 1),
    newsletter("o2", 2),
    spotifyReceipt("o3", 3),
    newsletter("o4", 4),
    netflixRenewal("o5", 5),
    netflixRenewal("o-old", 400),
  ];
  const fake = startFake({ codeO: { outlookAddress: "o@outlook.com", gmail: [], outlook: outlookMail } });
  const outlook = outlookProvider(microsoft, fake.http);
  const grant = await outlook.exchangeCode({ code: "codeO", codeVerifier: "v".repeat(43), redirectUri: "r" });

  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let listed = 0;
  do {
    const page = await outlook.listPage(grant.accessToken, { backfill: true, sinceMs: Date.now() - 365 * DAY, cursor });
    ids.push(...page.ids);
    listed += page.listed;
    cursor = page.next;
    pages++;
  } while (cursor && pages < 20);

  expect(pages).toBe(3); // five messages within the year, two per page
  expect(listed).toBe(5);
  expect(ids.sort()).toEqual(["o1", "o3", "o5"]);
  expect(fake.log.graphUrls[0]).toContain("receivedDateTime");
  expect(decodeURIComponent(fake.log.graphUrls[0]!)).toMatch(/\$select=id,subject,from,receivedDateTime/);
  expect(fake.log.graphHeaders.every((h) => h.prefer === 'IdType="ImmutableId"')).toBe(true);

  // A nextLink pointing anywhere but Graph is not followed with the token.
  const page = await outlook.listPage(grant.accessToken, { backfill: true, sinceMs: 0, cursor: "https://evil.example/v1.0/me/messages?$skiptoken=2" });
  expect(fake.log.requests.some((r) => r.includes("evil.example"))).toBe(false);
  expect(page.listed).toBeGreaterThan(0);
});

test("outlook graph: Microsoft has no server-side revocation for personal accounts, so it names the page", async () => {
  const fake = startFake({});
  const outlook = outlookProvider(microsoft, fake.http);
  expect(await outlook.revoke("m-refresh-x")).toEqual({ revoked: false, manualRevokeUrl: "https://account.live.com/consent/Manage" });
  expect(fake.log.requests).toEqual([]);
});

test("full message: Gmail is read with format=raw and the bytes are the whole message", async () => {
  const m = netflixRenewal("g1", 2);
  const fake = startFake({ codeG: { gmailAddress: "g@gmail.com", gmail: [m], outlook: [] } });
  const gmail = gmailProvider(google, fake.http);
  const grant = await gmail.exchangeCode({ code: "codeG", codeVerifier: "v".repeat(43), redirectUri: "r" });
  const raw = await gmail.fetchRaw(grant.accessToken, "g1");
  expect(Buffer.from(raw!).equals(Buffer.from(m.raw))).toBe(true);
  expect(fake.log.rawFetches).toEqual(["gmail:g1:raw"]);
  expect(await gmail.fetchRaw(grant.accessToken, "missing")).toBeNull();
});

test("full message: Outlook is read as MIME through $value", async () => {
  const m = spotifyReceipt("o1", 2);
  const fake = startFake({ codeO: { outlookAddress: "o@outlook.com", gmail: [], outlook: [m] } });
  const outlook = outlookProvider(microsoft, fake.http);
  const grant = await outlook.exchangeCode({ code: "codeO", codeVerifier: "v".repeat(43), redirectUri: "r" });
  const raw = await outlook.fetchRaw(grant.accessToken, "o1");
  expect(Buffer.from(raw!).equals(Buffer.from(m.raw))).toBe(true);
  expect(fake.log.rawFetches).toEqual(["outlook:o1:$value"]);
});

test("full message: a message over the size bound is not downloaded in full", async () => {
  const declared = new Response("x".repeat(10), { headers: { "content-length": "999999999" } });
  expect(await readBounded(declared, 1000)).toBeNull();
  const streamed = new Response(new ReadableStream({
    start(c) {
      for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(400));
      c.close();
    },
  }));
  expect(await readBounded(streamed, 1000)).toBeNull();
  expect((await readBounded(new Response(new Uint8Array(500)), 1000))!.byteLength).toBe(500);
});

test("email oauth: Gmail asks for gmail.readonly alone, offline, with consent and PKCE S256", () => {
  const fake = startFake({});
  const gmail = gmailProvider(google, fake.http);
  const url = new URL(gmail.authorizeUrl({ state: "s1", codeChallenge: "c".repeat(43), redirectUri: "http://backend.test/api/v1/email/oauth/gmail/callback" }));
  expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPE);
  expect(url.searchParams.get("access_type")).toBe("offline");
  expect(url.searchParams.get("prompt")).toBe("consent");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("include_granted_scopes")).toBeNull();
  expect(gmail.grantsMailRead("openid email")).toBe(false);
  expect(gmail.grantsMailRead(GMAIL_SCOPE)).toBe(true);
});

test("inbox sync: Gmail searches stay short, cover every billing term, and are always bounded in time", () => {
  const clauses = gmailTermClauses();
  expect(clauses.length).toBeGreaterThan(1);
  for (const c of clauses) expect(c.length).toBeLessThan(600);
  const all = clauses.join(" ");
  for (const term of BILLING_TERMS) expect(all).toContain(term.includes(" ") || /[^\p{L}\p{N}]/u.test(term) ? `"${term}"` : term);
  expect(clauses[0]).toStartWith("(category:purchases OR subject:(");
  expect(gmailQuery(clauses[1]!, { backfill: true, sinceMs: 0 })).toStartWith("newer_than:1y smaller:10M subject:(");
  expect(gmailQuery(clauses[1]!, { backfill: false, sinceMs: 1_700_000_000_123 })).toStartWith("after:1700000000 ");
});

test("inbox sync: provider calls retry throttling briefly, then give up for the next pass", async () => {
  let calls = 0;
  const http = providerHttp(null, async () => {
    calls++;
    return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
  }, async () => {});
  await expect(callWithRetry(http, "https://gmail.googleapis.com/x", {})).rejects.toBeInstanceOf(ProviderBusyError);
  expect(calls).toBe(3);

  // A Retry-After longer than a pass should wait ends it at once.
  calls = 0;
  const slow = providerHttp(null, async () => {
    calls++;
    return new Response("{}", { status: 503, headers: { "retry-after": "3600" } });
  }, async () => {});
  await expect(callWithRetry(slow, "https://gmail.googleapis.com/x", {})).rejects.toBeInstanceOf(ProviderBusyError);
  expect(calls).toBe(1);
});

test("outlook graph: the development override rewrites every provider URL, nextLinks included, and nothing else", () => {
  const o = "http://localhost:9999/";
  expect(providerUrl("https://graph.microsoft.com/v1.0/me/messages?$top=2&$skiptoken=4", o)).toBe(
    "http://localhost:9999/graph.microsoft.com/v1.0/me/messages?$top=2&$skiptoken=4"
  );
  expect(providerUrl("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", o)).toBe(
    "http://localhost:9999/login.microsoftonline.com/consumers/oauth2/v2.0/token"
  );
  expect(providerUrl("https://oauth2.googleapis.com/token", null)).toBe("https://oauth2.googleapis.com/token");
  expect(providerUrl("http://insecure.example/x", o)).toBe("http://insecure.example/x");
});

test("email oauth: Google's revoke endpoint is called with the token; an already-revoked token counts as revoked", async () => {
  const fake = startFake({ codeG: { gmailAddress: "g@gmail.com", gmail: [], outlook: [] } });
  const gmail = gmailProvider(google, fake.http);
  const grant = await gmail.exchangeCode({ code: "codeG", codeVerifier: "v".repeat(43), redirectUri: "r" });
  expect(await gmail.revoke(grant.refreshToken!)).toEqual({ revoked: true });
  expect(fake.log.googleRevoked).toEqual([grant.refreshToken!]);
  // Revoked already (by the user, from their Google account): still done.
  expect(await gmail.revoke(grant.refreshToken!)).toEqual({ revoked: true });
  fake.failNext(/oauth2\.googleapis\.com\/revoke/, 500, 3);
  await expect(gmail.revoke("g-refresh-x")).rejects.toThrow("provider_busy");

});
