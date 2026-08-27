import { randomBytes } from "crypto";

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
 * Pure so it can be tested without waiting out a real window.
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

export function makeJoinRateLimiter() {
  const attempts = new Map<string, RateLimitState>();
  return (userId: string, now = Date.now()): boolean => {
    const { allowed, next } = checkRateLimit(attempts.get(userId), now);
    attempts.set(userId, next);
    return allowed;
  };
}

export { JOIN_MAX, JOIN_WINDOW_MS };
