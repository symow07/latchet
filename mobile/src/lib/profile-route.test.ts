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
