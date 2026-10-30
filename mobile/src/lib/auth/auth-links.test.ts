import { describe, expect, test } from 'bun:test';
import {
  checkNewPassword,
  cooldownSecondsLeft,
  looksLikeEmail,
  readResetLink,
  readVerifyLink,
  RESEND_COOLDOWN_MS,
} from './auth-links';

const TOKEN = 'aB3dE5gH7jK9mN1pQ3sT5vW7'; // 24, like Better Auth's. gitleaks:allow (a test value)

describe('the reset link landing', () => {
  test('a token from the server is ready to use', () => {
    expect(readResetLink({ token: TOKEN })).toEqual({ kind: 'ready', token: TOKEN });
    // A repeated key arrives as an array; the first wins.
    expect(readResetLink({ token: [TOKEN, 'other'] })).toEqual({ kind: 'ready', token: TOKEN });
  });

  test('the server’s error, a missing token or a mangled one is the expired-link state', () => {
    expect(readResetLink({ error: 'INVALID_TOKEN' })).toEqual({ kind: 'invalid' });
    expect(readResetLink({ token: TOKEN, error: 'INVALID_TOKEN' })).toEqual({ kind: 'invalid' });
    expect(readResetLink({})).toEqual({ kind: 'invalid' });
    expect(readResetLink({ token: '' })).toEqual({ kind: 'invalid' });
    expect(readResetLink({ token: 'aB3dE5' })).toEqual({ kind: 'invalid' }); // cut short
    expect(readResetLink({ token: `${TOKEN}"><script>` })).toEqual({ kind: 'invalid' });
  });
});

describe('the verification link landing', () => {
  test('no error means verified; the server’s codes say why not', () => {
    expect(readVerifyLink({})).toBe('verified');
    expect(readVerifyLink({ error: 'TOKEN_EXPIRED' })).toBe('expired');
    expect(readVerifyLink({ error: ['token_expired'] })).toBe('expired');
    expect(readVerifyLink({ error: 'INVALID_TOKEN' })).toBe('invalid');
    expect(readVerifyLink({ error: 'USER_NOT_FOUND' })).toBe('invalid');
  });
});

describe('resend cooldown', () => {
  test('counts down in whole seconds and reaches zero', () => {
    const sentAt = 1_000_000;
    expect(cooldownSecondsLeft(null, sentAt)).toBe(0);
    expect(cooldownSecondsLeft(sentAt, sentAt)).toBe(RESEND_COOLDOWN_MS / 1000);
    expect(cooldownSecondsLeft(sentAt, sentAt + 59_001)).toBe(1);
    expect(cooldownSecondsLeft(sentAt, sentAt + 60_000)).toBe(0);
    expect(cooldownSecondsLeft(sentAt, sentAt + 120_000)).toBe(0);
  });
});

describe('form rules', () => {
  test('an address needs a local part, an @ and a dotted domain', () => {
    expect(looksLikeEmail(' sam@example.com ')).toBe(true);
    expect(looksLikeEmail('sam@example')).toBe(false);
    expect(looksLikeEmail('sam example.com')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });

  test('a new password is long enough, not too long, and confirmed', () => {
    expect(checkNewPassword('', '')).toBe('missing');
    expect(checkNewPassword('short', 'short')).toBe('short');
    expect(checkNewPassword('x'.repeat(129), 'x'.repeat(129))).toBe('long');
    expect(checkNewPassword('long-enough', 'long-enougH')).toBe('mismatch');
    expect(checkNewPassword('long-enough', 'long-enough')).toBeNull();
  });
});
