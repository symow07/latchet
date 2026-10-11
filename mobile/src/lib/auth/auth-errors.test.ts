import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setLocale, t } from '../i18n/core';
import { AUTH_ERROR_KEYS, authErrorCode, authErrorKey, authErrorMessage } from './auth-errors';

afterAll(() => setLocale('en'));

describe('the auth error mapper', () => {
  test('known Better Auth codes become their own sentence', () => {
    expect(authErrorKey({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 }, 'auth.errorFailed')).toBe('auth.errorInvalid');
    expect(authErrorKey({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', status: 422 }, 'auth.errorCreateFailed')).toBe('auth.errorExists');
    expect(authErrorKey({ code: 'PASSWORD_TOO_SHORT', status: 400 }, 'x')).toBe('auth.errorShortPassword');
    expect(authErrorKey({ code: 'INVALID_TOKEN', status: 400 }, 'x')).toBe('resetPassword.invalidBody');
    expect(authErrorCode({ code: 'INVALID_TOKEN' })).toBe('INVALID_TOKEN');
    expect(authErrorCode(new Error('x'))).toBeNull();
  });

  test('the network and the rate limiters have their own sentences', () => {
    expect(authErrorKey(new TypeError('Network request failed'), 'auth.errorFailed')).toBe('auth.errorNetwork');
    expect(authErrorKey({ message: 'The request timed out.' }, 'auth.errorFailed')).toBe('auth.errorNetwork');
    expect(authErrorKey({ status: 429, statusText: 'Too Many Requests' }, 'auth.errorFailed')).toBe('auth.errorRateLimited');
  });

  test('anything else is the screen’s fallback, never the server’s English', () => {
    setLocale('fr');
    const message = authErrorMessage({ code: 'SOMETHING_NEW', message: 'Something new went wrong', status: 500 }, 'auth.errorFailed');
    expect(message).toBe(t('auth.errorFailed'));
    expect(message).not.toContain('Something new');
    expect(authErrorMessage(undefined, 'auth.errorFailed')).toBe(t('auth.errorFailed'));
    setLocale('en');
  });

  test('every key it can produce exists in all four languages', () => {
    for (const locale of ['en', 'fr', 'ar', 'zh'] as const) {
      setLocale(locale);
      for (const key of AUTH_ERROR_KEYS) expect(t(key)).not.toContain('missing');
    }
    setLocale('en');
  });
});

describe('the auth screens', () => {
  const appDir = join(import.meta.dir, '..', '..', 'app');

  test('share the one mapper instead of keeping their own', () => {
    const offenders = readdirSync(appDir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /function friendlyAuthError/.test(readFileSync(join(appDir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
