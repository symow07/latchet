import { test, expect, afterAll } from "bun:test";
import type { Context } from "hono";
import { prisma } from "./prisma";
import {
  createRateLimiter,
  signupBurstRateLimiter,
  loginRateLimiter,
} from "./auth";

/**
 * The limiters count in Postgres, so a count outlives the test run that made
 * it. Every address and identifier here is unique to this run, and the rows
 * are removed afterwards.
 */
const RUN = `${process.pid}-${Date.now().toString(36)}`;
/** A documentation-range address (RFC 5737) tagged with this run. */
const addr = (n: number) => `203.0.113.${n}#${RUN}`;
afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
});

/** Minimal stand-in for the slice of Hono's Context the limiters touch. */
function ctx(ip: string, identifier?: string) {
  return {
    req: {
      header: (name: string) =>
        name === "x-forwarded-for"
          ? ip
          : name === "x-rate-limit-identifier"
            ? identifier
            : undefined,
      query: () => undefined,
    },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as unknown as Context;
}

const next = async () => {};

/** Runs a limiter once; returns the HTTP status it would produce. */
async function hit(
  limiter: (c: Context, n: typeof next) => Promise<unknown>,
  ip: string,
  identifier?: string
): Promise<number> {
  const res = (await limiter(ctx(ip, identifier), next)) as
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

test("per-identifier limits apply once the client sends the header", async () => {
  const limiter = createRateLimiter({
    scope: `test-id-${RUN}`,
    ipMax: 100,
    ipWindowMs: 60_000,
    identifierMax: 2,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });

  // Same identifier from different IPs — only the identifier budget binds.
  expect(await hit(limiter, addr(101), "a@example.com")).toBe(200);
  expect(await hit(limiter, addr(102), "a@example.com")).toBe(200);
  expect(await hit(limiter, addr(103), "a@example.com")).toBe(429);
});

test("a request with no identifier still passes the identifier check", async () => {
  const limiter = createRateLimiter({
    scope: `test-anon-${RUN}`,
    ipMax: 10,
    ipWindowMs: 60_000,
    identifierMax: 1,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });

  expect(await hit(limiter, addr(109))).toBe(200);
  expect(await hit(limiter, addr(109))).toBe(200);
});

test("exhausting the sign-up limit does not lock the same IP out of sign-in", async () => {
  const ip = addr(30);
  // Blow well past the sign-up budget, tripping its lockout.
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
    identifierMax: 99,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });
  const scopeB = createRateLimiter({
    scope: `scope-b-${RUN}`,
    ipMax: 2,
    ipWindowMs: 60_000,
    identifierMax: 99,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });

  expect(await hit(scopeA, ip)).toBe(200);
  expect(await hit(scopeA, ip)).toBe(200);
  expect(await hit(scopeA, ip)).toBe(429);

  // B has its own counter — previously both shared one record per IP.
  expect(await hit(scopeB, ip)).toBe(200);
});

// ── Lockouts ─────────────────────────────────────────────────────────────────

test("tripping the sign-in limit for an account locks it, from any address", async () => {
  // Five per identifier, and the threshold is five: the sixth attempt is
  // refused and locks the account, so a seventh from a fresh address is
  // still refused — with the lockout's own message.
  const victim = `victim-${RUN}@example.com`;
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push(await hit(loginRateLimiter, addr(50 + i), victim));
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);

  const res = (await loginRateLimiter(ctx(addr(60), victim), next)) as unknown as { body: { error: string }; status: number };
  expect(res.status).toBe(429);
  expect(res.body.error).toBe("Account temporarily locked, try again later");
});

test("a limit below its lockout threshold refuses without locking", async () => {
  // Sign-up allows three per identifier with a threshold of five: the fourth
  // is refused for the account, but nothing is locked, so the message stays
  // the rate-limit one and other addresses are not refused for the lockout.
  const who = `signup-${RUN}@example.com`;
  for (let i = 0; i < 3; i++) expect(await hit(signupBurstRateLimiter, addr(70 + i), who)).toBe(200);
  const refused = (await signupBurstRateLimiter(ctx(addr(74), who), next)) as unknown as { body: { error: string } };
  expect(refused.body.error).toBe("Too many requests for this account, try again later");
  const locks = await prisma.rateLimitBucket.count({ where: { key: { startsWith: "lockout:signup-burst:id:" + who } } });
  expect(locks).toBe(0);
});

test("an IP over its limit is locked out once the threshold is reached", async () => {
  const limiter = createRateLimiter({
    scope: `test-lock-${RUN}`,
    ipMax: 2,
    ipWindowMs: 60_000,
    identifierMax: 99,
    identifierWindowMs: 60_000,
    lockoutThreshold: 2,
  });
  const ip = addr(80);
  expect(await hit(limiter, ip)).toBe(200);
  expect(await hit(limiter, ip)).toBe(200);
  expect(await hit(limiter, ip)).toBe(429);
  const lock = await prisma.rateLimitBucket.findUnique({ where: { key: `lockout:test-lock-${RUN}:ip:${ip}` } });
  expect(lock).not.toBeNull();
  // Fifteen minutes, by the database's clock.
  const minutes = (lock!.expiresAt.getTime() - lock!.windowStart.getTime()) / 60_000;
  expect(minutes).toBe(15);
});

test("an identifier header of any length is limited, not a server error", async () => {
  // Keys become primary-key entries; a long one is stored hashed.
  const huge = "x".repeat(10_000) + RUN;
  const limiter = createRateLimiter({
    scope: `test-long-${RUN}`,
    ipMax: 100,
    ipWindowMs: 60_000,
    identifierMax: 1,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });
  expect(await hit(limiter, addr(90), huge)).toBe(200);
  expect(await hit(limiter, addr(91), huge)).toBe(429);
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: `test-long-${RUN}` } } });
});
