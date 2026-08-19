import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison.
 *
 * `!==` on a shared secret returns as soon as two bytes differ, so response
 * time leaks how much of a guess was correct — enough to recover a webhook
 * secret byte by byte.
 */
export function secretsMatch(
  provided: string | undefined | null,
  expected: string | undefined | null
): boolean {
  if (!provided || !expected) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal — hash both to a fixed width first.
  if (a.length !== b.length) {
    // Still do the comparison so a wrong-length guess costs the same.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
