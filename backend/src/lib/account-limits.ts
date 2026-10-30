import { prisma } from "../prisma";
import type { Db } from "./distributed/clock";
import { forget, hitWindow, lockFor, lockedKeys } from "./distributed/counter";

/**
 * Limits counted per account, which the address limits in auth.ts cannot do:
 * those run before Better Auth has read the request, and reading the body
 * there deadlocks under Bun (see auth.ts). These run from Better Auth's own
 * hooks (auth.ts, `hooks`), after it has parsed the body itself.
 *
 * An account here is the email address as typed, trimmed and lower-cased (as
 * Better Auth stores it), not a user id. An address with no account behind it
 * is counted the same way, so the answer never says whether one exists.
 *
 * Counts live in Postgres with the other limits (lib/distributed/counter.ts),
 * shared by every instance.
 */

/** Wrong passwords allowed for one account inside the window before sign-in pauses. */
export const FAILED_SIGN_IN_MAX = 10;
export const FAILED_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
/** How long sign-in stays paused once the tenth wrong password lands. */
export const SIGN_IN_PAUSE_MS = 15 * 60 * 1000;

/**
 * Sign-up attempts per address, checked in order: a burst limit and a daily
 * ceiling. Each attempt can send a verification mail to that address, so this
 * is what stops someone filling a stranger's inbox from many networks.
 */
export const SIGN_UP_LIMITS = [
  { scope: "signup-burst", max: 3, windowMs: 60 * 60 * 1000 },
  { scope: "signup-daily", max: 10, windowMs: 24 * 60 * 60 * 1000 },
] as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const failedSignInKey = (email: string) => `sign-in-failed:${normalizeEmail(email)}`;

/** Whether sign-in is paused for this account. A correct password is refused too. */
export async function signInPaused(email: string, db: Db = prisma): Promise<boolean> {
  const key = failedSignInKey(email);
  return (await lockedKeys([key], db)).has(key);
}

/** Count one wrong password. The tenth inside the window pauses sign-in. */
export async function recordFailedSignIn(email: string, db: Db = prisma): Promise<void> {
  const key = failedSignInKey(email);
  const hit = await hitWindow(key, FAILED_SIGN_IN_MAX, FAILED_SIGN_IN_WINDOW_MS, db);
  if (hit.count >= FAILED_SIGN_IN_MAX) await lockFor(key, SIGN_IN_PAUSE_MS, db);
}

/**
 * Start the count again and lift any pause. A successful sign-in does this,
 * and so does a password reset: someone else typing wrong passwords for an
 * address can pause it, and resetting the password is how its owner gets
 * straight back in.
 */
export async function clearFailedSignIns(email: string, db: Db = prisma): Promise<void> {
  await forget(failedSignInKey(email), db);
}

/** Count one sign-up attempt for this address; false once it is over a limit. */
export async function signUpAllowed(email: string, db: Db = prisma): Promise<boolean> {
  for (const { scope, max, windowMs } of SIGN_UP_LIMITS) {
    const hit = await hitWindow(`${scope}:email:${normalizeEmail(email)}`, max, windowMs, db);
    if (!hit.allowed) return false;
  }
  return true;
}
