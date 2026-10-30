import { test, expect, afterAll } from "bun:test";
import type { Context } from "hono";
import { prisma } from "./prisma";
import {
  createRateLimiter,
  generalAuthRateLimiter,
  isSessionRead,
  sessionRateLimiter,
  sharedAuthLimiter,
  signupBurstRateLimiter,
  loginRateLimiter,
} from "./auth";

/**
 * The address limiters that run ahead of Better Auth. The limits per account
 * run inside it: lib/account-limits.test.ts, and auth-flows.test.ts through
 * the app.
 *
 * The limiters count in Postgres, so a count outlives the test run that made
 * it. Every address here is unique to this run, and the rows are removed
 * afterwards.
 */
const RUN = `${process.pid}-${Date.now().toString(36)}`;
/** A documentation-range address (RFC 5737) tagged with this run. */
const addr = (n: number) => `203.0.113.${n}#${RUN}`;
afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
});

/** Minimal stand-in for the slice of Hono's Context the limiters touch. */
function ctx(ip: string) {
  return {
    req: { header: (name: string) => (name === "x-forwarded-for" ? ip : undefined) },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as unknown as Context;
}

const next = async () => {};

/** Runs a limiter once; returns the HTTP status it would produce. */
async function hit(
  limiter: (c: Context, n: typeof next) => Promise<unknown>,
  ip: string
): Promise<number> {
  const res = (await limiter(ctx(ip), next)) as
    | { status: number }
    | undefined;
  return res?.status ?? 200;
}

test("the sixth sign-up from one IP is rejected", async () => {
  const ip = addr(10);
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push(await hit(signupBurstRateLimiter, ip));

  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(statuses[5]).toBe(429);
});

test("a different IP is unaffected by another's sign-up limit", async () => {
  const busy = addr(20);
  for (let i = 0; i < 6; i++) await hit(signupBurstRateLimiter, busy);

  expect(await hit(signupBurstRateLimiter, addr(21))).toBe(200);
});

test("exhausting the sign-up limit does not lock the same IP out of sign-in", async () => {
  const ip = addr(30);
  // Blow well past the sign-up budget.
  for (let i = 0; i < 12; i++) await hit(signupBurstRateLimiter, ip);
  expect(await hit(signupBurstRateLimiter, ip)).toBe(429);

  // Sign-in has its own namespace, so a shared/NAT address is still usable.
  expect(await hit(loginRateLimiter, ip)).toBe(200);
});

test("limiters do not consume each other's budget", async () => {
  const ip = addr(40);
  const scopeA = createRateLimiter({
    scope: `scope-a-${RUN}`,
    ipMax: 2,
    ipWindowMs: 60_000,
  });
  const scopeB = createRateLimiter({
    scope: `scope-b-${RUN}`,
    ipMax: 2,
    ipWindowMs: 60_000,
  });

  expect(await hit(scopeA, ip)).toBe(200);
  expect(await hit(scopeA, ip)).toBe(200);
  expect(await hit(scopeA, ip)).toBe(429);

  // B has its own counter — previously both shared one record per IP.
  expect(await hit(scopeB, ip)).toBe(200);
});

// One address is often many people: a carrier's NAT, an office, a VPN exit.
// An address over its limit used to be locked for 15 minutes, which shut
// sign-in for all of them because one of them went over.
test("an address over the sign-in limit is refused, and never locked", async () => {
  const ip = addr(80);
  const statuses: number[] = [];
  for (let i = 0; i < 16; i++) statuses.push(await hit(loginRateLimiter, ip));
  expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true);
  expect(statuses[15]).toBe(429);
  const locks = await prisma.rateLimitBucket.count({ where: { key: { startsWith: "lockout:", contains: ip } } });
  expect(locks).toBe(0);
});

test("an address refused by its window is let in again when the window ends", async () => {
  const limiter = createRateLimiter({
    scope: `test-window-${RUN}`,
    ipMax: 2,
    ipWindowMs: 1_000,
  });
  const ip = addr(87);
  expect(await hit(limiter, ip)).toBe(200);
  expect(await hit(limiter, ip)).toBe(200);
  expect(await hit(limiter, ip)).toBe(429);
  await Bun.sleep(1_100);
  expect(await hit(limiter, ip)).toBe(200);
});

// The app reads the session on every launch and every return to the
// foreground. Under the general limit (30 per address per 15 minutes) that ran
// out, the app took the refusal for "signed out", and the lockout then shut
// sign-in too. Found by the end-to-end suite, which cold-starts the app often.
test("session reads have their own wide window and leave the general limit alone", async () => {
  const ip = addr(70);
  const reads: number[] = [];
  for (let i = 0; i < 100; i++) reads.push(await hit(sessionRateLimiter, ip));
  expect(reads.every((s) => s === 200)).toBe(true);
  // The same address still has its whole general budget for sign-out and the rest.
  expect(await hit(generalAuthRateLimiter, ip)).toBe(200);
});

test("an address header of any length is limited, not a server error", async () => {
  // Keys become primary-key entries; a long one is stored hashed.
  const limiter = createRateLimiter({ scope: `test-long-${RUN}`, ipMax: 1, ipWindowMs: 60_000 });
  const huge = "x".repeat(10_000) + RUN;
  expect(await hit(limiter, huge)).toBe(200);
  expect(await hit(limiter, huge)).toBe(429);
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: `test-long-${RUN}` } } });
});

test("only GET /api/auth/get-session counts as a session read", () => {
  expect(isSessionRead("GET", "/api/auth/get-session")).toBe(true);
  expect(isSessionRead("GET", "/api/auth/get-session/")).toBe(true);
  expect(isSessionRead("POST", "/api/auth/get-session")).toBe(false);
  expect(isSessionRead("GET", "/api/auth/sign-in/email")).toBe(false);
  expect(isSessionRead("GET", "/api/auth/get-session-and-more")).toBe(false);
});

test("sign-in and sign-up are counted by their own limits only, not the general one", () => {
  expect(sharedAuthLimiter("POST", "/api/auth/sign-in/email")).toBeNull();
  expect(sharedAuthLimiter("POST", "/api/auth/sign-in/social")).toBeNull();
  expect(sharedAuthLimiter("POST", "/api/auth/sign-up/email")).toBeNull();
  expect(sharedAuthLimiter("GET", "/api/auth/get-session")).toBe(sessionRateLimiter);
  expect(sharedAuthLimiter("POST", "/api/auth/sign-out")).toBe(generalAuthRateLimiter);
  expect(sharedAuthLimiter("POST", "/api/auth/request-password-reset")).toBe(generalAuthRateLimiter);
  expect(sharedAuthLimiter("GET", "/api/auth/sign-in-elsewhere")).toBe(generalAuthRateLimiter);
});

test("the served app still lets an address sign in after it used up the general limit", async () => {
  const { app } = await import("./index");
  const ip = addr(72);
  const general: number[] = [];
  for (let i = 0; i < 31; i++) {
    const res = await app.request("/api/auth/list-sessions", { headers: { "x-forwarded-for": ip } });
    general.push(res.status);
  }
  // The general limit (30 per address) is spent...
  expect(general[30]).toBe(429);
  // ...and sign-in from the same address is answered, not refused.
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({ email: `nobody-${RUN}@example.test`, password: "not-the-password-1" }),
  });
  expect(signIn.status).not.toBe(429);
});

test("the served app sends 40 session reads from one address without a 429", async () => {
  const { app } = await import("./index");
  const ip = addr(71);
  const statuses: number[] = [];
  for (let i = 0; i < 40; i++) {
    const res = await app.request("/api/auth/get-session", { headers: { "x-forwarded-for": ip } });
    statuses.push(res.status);
  }
  expect(statuses.filter((s) => s === 429)).toEqual([]);
});
