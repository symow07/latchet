import { test, expect } from "bun:test";
import {
  checkRateLimit,
  generateInviteCode,
  makeJoinRateLimiter,
  JOIN_MAX,
  JOIN_WINDOW_MS,
} from "./group-invites";

const NOW = 1_700_000_000_000;

test("the first attempt is allowed and opens a window", () => {
  const { allowed, next } = checkRateLimit(undefined, NOW);
  expect(allowed).toBe(true);
  expect(next.count).toBe(1);
  expect(next.resetAt).toBe(NOW + JOIN_WINDOW_MS);
});

test("attempts are allowed up to the limit and refused after", () => {
  const limit = makeJoinRateLimiter();
  for (let i = 0; i < JOIN_MAX; i++) expect(limit("u", NOW)).toBe(true);
  expect(limit("u", NOW)).toBe(false);
});

test("the window expiring resets the count", () => {
  const limit = makeJoinRateLimiter();
  for (let i = 0; i < JOIN_MAX + 3; i++) limit("u", NOW);
  expect(limit("u", NOW)).toBe(false);
  expect(limit("u", NOW + JOIN_WINDOW_MS + 1)).toBe(true);
});

test("one user being throttled does not throttle another", () => {
  const limit = makeJoinRateLimiter();
  for (let i = 0; i < JOIN_MAX + 1; i++) limit("noisy", NOW);
  expect(limit("noisy", NOW)).toBe(false);
  expect(limit("quiet", NOW)).toBe(true);
});

test("a refused attempt still counts, so hammering cannot outrun the window", () => {
  // If refusals did not increment, a caller could sit at the boundary forever.
  const limit = makeJoinRateLimiter();
  for (let i = 0; i < 100; i++) limit("u", NOW);
  expect(limit("u", NOW + JOIN_WINDOW_MS - 1)).toBe(false);
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
