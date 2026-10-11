import { randomBytes } from "crypto";
import { hitWindow } from "./distributed/counter";
import type { Db } from "./distributed/clock";

/**
 * Joining a group, by invite code and nothing else.
 *
 * There is deliberately no way to add someone by userId. That endpoint existed
 * once, was removed in Task 16, and is the shape App Store guideline 5.1.2
 * rejects: it lets one person put another under observation without the other
 * ever agreeing. Everything here assumes the joiner is the one acting.
 */

/** 6 hex characters. Short enough to read down a phone line, from a CSPRNG. */
export function generateInviteCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

const JOIN_MAX = 5;
const JOIN_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitState {
  count: number;
  resetAt: number;
}

/**
 * The rule the join limiter applies, as a pure function: a window opens on
 * the first attempt, every attempt in it counts (refused ones too, so
 * hammering cannot outrun it), and attempts past JOIN_MAX are refused until
 * the window closes. lib/distributed/counter implements the same rule in one
 * SQL statement; this stays as its readable specification.
 *
 * A 6-hex-character code is 16.7M possibilities, which is ample against five
 * tries per quarter hour but not against an unthrottled loop — the limiter is
 * what makes the code length sufficient rather than merely typical.
 */
export function checkRateLimit(
  entry: RateLimitState | undefined,
  now: number
): { allowed: boolean; next: RateLimitState } {
  if (!entry || now > entry.resetAt) {
    return { allowed: true, next: { count: 1, resetAt: now + JOIN_WINDOW_MS } };
  }
  const next = { count: entry.count + 1, resetAt: entry.resetAt };
  return { allowed: next.count <= JOIN_MAX, next };
}

/**
 * The join limiter for one kind of group: at most JOIN_MAX attempts per user
 * per JOIN_WINDOW_MS, refused attempts included — checkRateLimit's rule.
 *
 * Counted in Postgres (lib/distributed/counter), where it used to be a Map
 * held by the route module: each instance had its own five tries, so the
 * code-guessing budget grew with every instance and reset on every deploy.
 *
 * `scope` keeps groups apart: the household and business endpoints each have
 * their own budget, as they did when each had its own Map.
 */
export function makeJoinRateLimiter(
  scope: string,
  opts: { max?: number; windowMs?: number; db?: Db } = {}
) {
  const max = opts.max ?? JOIN_MAX;
  const windowMs = opts.windowMs ?? JOIN_WINDOW_MS;
  return async (userId: string): Promise<boolean> =>
    (await hitWindow(`join:${scope}:${userId}`, max, windowMs, opts.db)).allowed;
}

export { JOIN_MAX, JOIN_WINDOW_MS };
