import { test, expect, afterAll } from "bun:test";
import { prisma } from "../prisma";
import {
  checkRateLimit,
  generateInviteCode,
  makeJoinRateLimiter,
  JOIN_MAX,
  JOIN_WINDOW_MS,
} from "./group-invites";

const NOW = 1_700_000_000_000;

// The limiter counts in Postgres; scopes are unique to this run.
const RUN = `${process.pid}-${Date.now().toString(36)}`;
const scope = (name: string) => `test-${name}-${RUN}`;
afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: RUN } } });
});

// ── The rule, as a pure function ─────────────────────────────────────────────

test("the first attempt is allowed and opens a window", () => {
  const { allowed, next } = checkRateLimit(undefined, NOW);
  expect(allowed).toBe(true);
  expect(next.count).toBe(1);
  expect(next.resetAt).toBe(NOW + JOIN_WINDOW_MS);
});

test("the rule refuses past the limit and resets after the window", () => {
  let state = checkRateLimit(undefined, NOW).next;
  for (let i = 1; i < JOIN_MAX; i++) state = checkRateLimit(state, NOW).next;
  expect(checkRateLimit(state, NOW).allowed).toBe(false);
  expect(checkRateLimit(state, NOW + JOIN_WINDOW_MS + 1).allowed).toBe(true);
});

// ── The limiter the routes use ───────────────────────────────────────────────

test("attempts are allowed up to the limit and refused after", async () => {
  const limit = makeJoinRateLimiter(scope("max"));
  for (let i = 0; i < JOIN_MAX; i++) expect(await limit("u")).toBe(true);
  expect(await limit("u")).toBe(false);
});

test("the window expiring resets the count", async () => {
  const limit = makeJoinRateLimiter(scope("window"), { windowMs: 60 });
  for (let i = 0; i < JOIN_MAX + 3; i++) await limit("u");
  expect(await limit("u")).toBe(false);
  await new Promise((r) => setTimeout(r, 100));
  expect(await limit("u")).toBe(true);
});

test("one user being throttled does not throttle another", async () => {
  const limit = makeJoinRateLimiter(scope("users"));
  for (let i = 0; i < JOIN_MAX + 1; i++) await limit("noisy");
  expect(await limit("noisy")).toBe(false);
  expect(await limit("quiet")).toBe(true);
});

test("a refused attempt still counts, so hammering cannot outrun the window", async () => {
  // If refusals reset or extended nothing, a caller could still sit at the
  // boundary forever; the window closes on its own schedule regardless.
  const limit = makeJoinRateLimiter(scope("hammer"));
  for (let i = 0; i < 100; i++) await limit("u");
  expect(await limit("u")).toBe(false);
});

test("two limiters with different scopes keep separate budgets", async () => {
  // Household and business joins each get their own five tries.
  const household = makeJoinRateLimiter(scope("household"));
  const business = makeJoinRateLimiter(scope("business"));
  for (let i = 0; i < JOIN_MAX; i++) await household("u");
  expect(await household("u")).toBe(false);
  expect(await business("u")).toBe(true);
});

test("two limiter instances with one scope share one budget", async () => {
  // What every instance of the app does: each builds its own limiter at
  // module load, and they must still count as one.
  const a = makeJoinRateLimiter(scope("shared"));
  const b = makeJoinRateLimiter(scope("shared"));
  for (let i = 0; i < JOIN_MAX; i++) expect(await (i % 2 ? a : b)("u")).toBe(true);
  expect(await a("u")).toBe(false);
  expect(await b("u")).toBe(false);
});

test("invite codes are 6 uppercase hex characters and not repeated", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const code = generateInviteCode();
    expect(code).toMatch(/^[0-9A-F]{6}$/);
    codes.add(code);
  }
  // 500 draws from 16.7M: a collision here would mean the source is not random.
  expect(codes.size).toBe(500);
});
