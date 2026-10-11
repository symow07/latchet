import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profileRedirect } from './profile-route';

/**
 * The profile split on launch.
 *
 * Both tab groups have an index, so "/" is ambiguous, and on a cold start a
 * personal account opened on the business tabs. The gate only redirected
 * business accounts. These tests hold the rule both ways, and the last one
 * holds the root layout to actually using it.
 */

describe('a personal account', () => {
  it('is sent home when "/" resolved to the business tabs (the cold-start bug)', () => {
    expect(profileRedirect('personal', ['(business-tabs)'])).toBe('/(tabs)');
  });

  it('is sent home from any business tab or business-only screen', () => {
    for (const segments of [
      ['(business-tabs)', 'expenses'],
      ['(business-tabs)', 'money'],
      ['business-tools'],
      ['business-profile'],
      ['business-tax'],
      ['business-team'],
    ]) {
      expect(profileRedirect('personal', segments)).toBe('/(tabs)');
    }
  });

  it('stays on its own tabs and on screens both profiles use', () => {
    for (const segments of [['(tabs)'], ['(tabs)', 'insights'], ['accounts'], ['receipt-scan'], ['onboarding']]) {
      expect(profileRedirect('personal', segments)).toBeNull();
    }
  });
});

describe('a business account', () => {
  it('is sent to the business tabs when "/" resolved to the personal ones', () => {
    expect(profileRedirect('business', ['(tabs)'])).toBe('/(business-tabs)');
    expect(profileRedirect('business', ['(tabs)', 'add'])).toBe('/(business-tabs)');
  });

  it('finishes choosing Business on the profile picker', () => {
    expect(profileRedirect('business', ['account-type'])).toBe('/(business-tabs)');
  });

  it('stays on its own tabs and on the business screens', () => {
    for (const segments of [['(business-tabs)'], ['(business-tabs)', 'expenses'], ['business-tools'], ['currency']]) {
      expect(profileRedirect('business', segments)).toBeNull();
    }
  });
});

describe('an account with no profile yet', () => {
  it('is sent to the picker, and left alone once there', () => {
    expect(profileRedirect(null, ['(tabs)'])).toBe('/account-type');
    expect(profileRedirect(null, ['(business-tabs)'])).toBe('/account-type');
    expect(profileRedirect(null, [])).toBe('/account-type');
    expect(profileRedirect(null, ['account-type'])).toBeNull();
  });
});

describe('the password-reset and verification landings', () => {
  const layout = readFileSync(join(import.meta.dir, '..', 'app', '_layout.tsx'), 'utf8');

  it('stay open for every profile, including an account with none yet', () => {
    // The verification link goes out at sign-up, before a profile is chosen:
    // redirecting a new account to the picker would swallow it.
    for (const accountType of [null, 'personal', 'business'] as const) {
      for (const top of ['reset-password', 'verify-email']) {
        expect(profileRedirect(accountType, [top])).toBeNull();
      }
    }
  });

  it('are registered outside both guards in the root layout', () => {
    const lastGuardEnd = layout.lastIndexOf('</Stack.Protected>');
    for (const name of ['reset-password', 'verify-email']) {
      const at = layout.indexOf(`name="${name}"`);
      expect(at).toBeGreaterThan(lastGuardEnd);
    }
  });
});

describe('forgot-password', () => {
  const layout = readFileSync(join(import.meta.dir, '..', 'app', '_layout.tsx'), 'utf8');

  it('is signed-out only: declared in the public group, so signing in closes it with sign-in', () => {
    // The simulator found it left on top of the app: sign-in → Forgot
    // password → (reset link) → sign-in with the notice → signed in, and the
    // public group closed beneath a forgot-password that was outside it.
    const open = layout.indexOf('<Stack.Protected guard={!signedIn || !dbReady}>');
    expect(open).toBeGreaterThan(-1);
    const close = layout.indexOf('</Stack.Protected>', open);
    const group = layout.slice(open, close);
    for (const name of ['login', 'signup', 'forgot-password']) {
      expect(group).toContain(`name="${name}"`);
    }
    expect(layout.split('name="forgot-password"')).toHaveLength(2);
  });

  it('is not exempt from the profile rules the way the landings are', () => {
    expect(profileRedirect(null, ['forgot-password'])).toBe('/account-type');
  });
});

describe('the root layout', () => {
  const layout = readFileSync(join(import.meta.dir, '..', 'app', '_layout.tsx'), 'utf8');

  it('asks profileRedirect, with the route the app is on, for every profile', () => {
    expect(layout).toMatch(/profileRedirect\(\s*accountType\s*,\s*segments\s*\)/);
    expect(layout).toMatch(/useSegments\(\)/);
  });

  it('no longer assumes "/" means personal', () => {
    expect(layout).not.toContain('accountType-personal-default');
    expect(layout).not.toMatch(/personal: default \(tabs\) route is correct/);
  });
});
