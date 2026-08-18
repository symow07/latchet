import { test, expect } from "bun:test";
import type { Context } from "hono";
import {
  createRateLimiter,
  signupBurstRateLimiter,
  loginRateLimiter,
} from "./auth";

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
  const ip = "203.0.113.10";
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push(await hit(signupBurstRateLimiter, ip));

  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(statuses[5]).toBe(429);
});

test("a different IP is unaffected by another's sign-up limit", async () => {
  const busy = "203.0.113.20";
  for (let i = 0; i < 6; i++) await hit(signupBurstRateLimiter, busy);

  expect(await hit(signupBurstRateLimiter, "203.0.113.21")).toBe(200);
});

test("per-identifier limits apply once the client sends the header", async () => {
  const limiter = createRateLimiter({
    scope: `test-id-${Math.random()}`,
    ipMax: 100,
    ipWindowMs: 60_000,
    identifierMax: 2,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });

  // Same identifier from different IPs — only the identifier budget binds.
  expect(await hit(limiter, "198.51.100.1", "a@example.com")).toBe(200);
  expect(await hit(limiter, "198.51.100.2", "a@example.com")).toBe(200);
  expect(await hit(limiter, "198.51.100.3", "a@example.com")).toBe(429);
});

test("a request with no identifier still passes the identifier check", async () => {
  const limiter = createRateLimiter({
    scope: `test-anon-${Math.random()}`,
    ipMax: 10,
    ipWindowMs: 60_000,
    identifierMax: 1,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });

  expect(await hit(limiter, "198.51.100.9")).toBe(200);
  expect(await hit(limiter, "198.51.100.9")).toBe(200);
});

test("exhausting the sign-up limit does not lock the same IP out of sign-in", async () => {
  const ip = "203.0.113.30";
  // Blow well past the sign-up budget, tripping its lockout.
  for (let i = 0; i < 12; i++) await hit(signupBurstRateLimiter, ip);
  expect(await hit(signupBurstRateLimiter, ip)).toBe(429);

  // Sign-in has its own namespace, so a shared/NAT address is still usable.
  expect(await hit(loginRateLimiter, ip)).toBe(200);
});

test("limiters do not consume each other's budget", async () => {
  const ip = "203.0.113.40";
  const scopeA = createRateLimiter({
    scope: "scope-a",
    ipMax: 2,
    ipWindowMs: 60_000,
    identifierMax: 99,
    identifierWindowMs: 60_000,
    lockoutThreshold: 99,
  });
  const scopeB = createRateLimiter({
    scope: "scope-b",
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
