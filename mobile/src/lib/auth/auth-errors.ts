import { t } from '../i18n/core';

/**
 * Turn an auth failure into a sentence in the user's language.
 *
 * One mapper for every auth screen. Sign-in and sign-up each had their own
 * copy, which passed the server's message straight through: a French user who
 * typed the wrong password read "Invalid email or password" in English. Better
 * Auth's errors carry a stable `code`, so the known ones are translated here;
 * anything else gets the screen's own fallback, also translated, rather than
 * an English sentence from the server.
 *
 * Accepts what the auth client returns (`{ code, message, status }`) and what
 * it throws (an Error, usually the network).
 */

const NETWORK = /network|failed to fetch|timed out|timeout|aborted|offline|internet connection/i;

const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.errorInvalid',
  INVALID_PASSWORD: 'auth.errorInvalid',
  USER_ALREADY_EXISTS: 'auth.errorExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.errorExists',
  INVALID_EMAIL: 'auth.errorInvalidEmail',
  PASSWORD_TOO_SHORT: 'auth.errorShortPassword',
  PASSWORD_TOO_LONG: 'auth.errorLongPassword',
  INVALID_TOKEN: 'resetPassword.invalidBody',
  TOKEN_EXPIRED: 'resetPassword.invalidBody',
  // Sign-in paused after ten wrong passwords (backend lib/account-limits.ts):
  // a 429 that says how to get back in, by resetting the password.
  TOO_MANY_FAILED_SIGN_INS: 'auth.errorSignInPaused',
};

/** Every key this module can resolve to, so a test can hold the catalogue to them. */
export const AUTH_ERROR_KEYS = [...new Set([...Object.values(BY_CODE), 'auth.errorNetwork', 'auth.errorRateLimited'])];

interface AuthErrorShape {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

function shape(error: unknown): AuthErrorShape {
  return error && typeof error === 'object' ? (error as AuthErrorShape) : {};
}

/** Better Auth's error code, when the failure carries one. */
export function authErrorCode(error: unknown): string | null {
  const code = shape(error).code;
  return typeof code === 'string' && code ? code : null;
}

/** The catalogue key for a failure; `fallbackKey` when nothing more specific applies. */
export function authErrorKey(error: unknown, fallbackKey: string): string {
  const { message, status } = shape(error);
  if (typeof error === 'string' ? NETWORK.test(error) : typeof message === 'string' && NETWORK.test(message)) {
    return 'auth.errorNetwork';
  }
  const code = authErrorCode(error);
  if (code && BY_CODE[code]) return BY_CODE[code];
  // The backend's address limiters answer 429 with no code; Better Auth's too.
  if (status === 429) return 'auth.errorRateLimited';
  return fallbackKey;
}

export function authErrorMessage(error: unknown, fallbackKey: string): string {
  return t(authErrorKey(error, fallbackKey));
}
