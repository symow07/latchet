import { describe, expect, it } from 'bun:test';
import { parsePreference, resolveScheme } from './theme-store';

describe('resolveScheme', () => {
  it('follows the OS when the preference is system', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
  });

  it('overrides the OS when the user has chosen', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('falls back to light, not dark, when the OS reports nothing', () => {
    // §2: "Light is the app. Dark is a faithful derivation." Defaulting an
    // unknown platform to the derivation shows the wrong app.
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('system', undefined)).toBe('light');
    expect(resolveScheme('system', 'unspecified')).toBe('light');
  });

  it('keeps an explicit choice even with no OS value', () => {
    expect(resolveScheme('dark', null)).toBe('dark');
  });
});

describe('parsePreference', () => {
  it('accepts the three valid values', () => {
    for (const v of ['system', 'light', 'dark'] as const) {
      expect(parsePreference(v)).toBe(v);
    }
  });

  it('falls back to system for anything else', () => {
    // A corrupt or half-written storage value must not throw at startup.
    for (const v of [null, undefined, '', 'Dark', 'auto', '{}']) {
      expect(parsePreference(v)).toBe('system');
    }
  });
});
