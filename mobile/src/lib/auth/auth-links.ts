/**
 * What a reset or verification link says when it lands in the app, and the
 * small rules the forgot/reset screens share.
 *
 * The links in the emails point at the backend, which checks the token and
 * redirects to realbudget://reset-password?token=… (or ?error=INVALID_TOKEN)
 * and realbudget://verify-email (or ?error=TOKEN_EXPIRED, INVALID_TOKEN, …).
 * expo-router hands the query to the screen as params, which may arrive as
 * an array when a key repeats.
 *
 * Dependency-free, so `bun test` holds it (auth-links.test.ts).
 */

type Param = string | string[] | undefined;

function first(param: Param): string {
  return ((Array.isArray(param) ? param[0] : param) ?? '').trim();
}

export type ResetLink = { kind: 'ready'; token: string } | { kind: 'invalid' };

/**
 * Better Auth mints reset tokens as 24 letters and digits. Anything else did
 * not come from it — a link cut short when copied, or typed by hand — and is
 * treated as the expired link it will turn out to be, without a round trip.
 */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function readResetLink(params: { token?: Param; error?: Param }): ResetLink {
  const token = first(params.token);
  if (first(params.error) || !TOKEN.test(token)) return { kind: 'invalid' };
  return { kind: 'ready', token };
}

export type VerifyLink = 'verified' | 'expired' | 'invalid';

/** No error means the server verified the address before redirecting here. */
export function readVerifyLink(params: { error?: Param }): VerifyLink {
  const error = first(params.error).toUpperCase();
  if (!error) return 'verified';
  return error === 'TOKEN_EXPIRED' ? 'expired' : 'invalid';
}

/** How long a "send it again" control waits after a send. */
export const RESEND_COOLDOWN_MS = 60_000;

/** Whole seconds until another send is allowed; 0 when it is. */
export function cooldownSecondsLeft(
  sentAt: number | null,
  now: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  if (sentAt === null) return 0;
  const left = sentAt + cooldownMs - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Enough of an address to be worth sending to; the server has the last word. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Better Auth's defaults, which the server enforces too. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export type NewPasswordProblem = 'missing' | 'short' | 'long' | 'mismatch';

/** What is wrong with a new password and its confirmation, or null. */
export function checkNewPassword(password: string, confirm: string): NewPasswordProblem | null {
  if (!password || !confirm) return 'missing';
  if (password.length < MIN_PASSWORD_LENGTH) return 'short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'long';
  if (password !== confirm) return 'mismatch';
  return null;
}
