import { describe, expect, test } from 'bun:test';
import {
  decideReturningAccount,
  resolveReturningAccount,
  type ReturningAccountDeps,
  type ReturningAccountFacts,
} from './returning-account';
import type { AccountType } from './account-type-store';

const fresh: ReturningAccountFacts = {
  pulled: true,
  settingsAreDefault: true,
  businessMember: false,
  storedAccountType: null,
  onboardingComplete: false,
};

describe('decideReturningAccount', () => {
  test('a brand-new account (epoch settings, no business) meets the picker and onboarding', () => {
    expect(decideReturningAccount(fresh)).toEqual({ returning: false, setAccountType: null, completeOnboarding: false });
  });

  test('configured settings on the server: personal, onboarding skipped', () => {
    expect(decideReturningAccount({ ...fresh, settingsAreDefault: false })).toEqual({
      returning: true,
      setAccountType: 'personal',
      completeOnboarding: true,
    });
  });

  test('a business membership means business, even with untouched settings', () => {
    expect(decideReturningAccount({ ...fresh, businessMember: true })).toEqual({
      returning: true,
      setAccountType: 'business',
      completeOnboarding: false,
    });
    expect(decideReturningAccount({ ...fresh, businessMember: true, settingsAreDefault: false })).toMatchObject({
      setAccountType: 'business',
      completeOnboarding: true,
    });
  });

  test('nothing is decided without the first pull', () => {
    expect(decideReturningAccount({ ...fresh, pulled: false, settingsAreDefault: false, businessMember: true })).toEqual({
      returning: false,
      setAccountType: null,
      completeOnboarding: false,
    });
  });

  test('a profile already chosen on this device is never overridden', () => {
    const decision = decideReturningAccount({ ...fresh, settingsAreDefault: false, businessMember: true, storedAccountType: 'personal' });
    expect(decision.setAccountType).toBeNull();
    expect(decision.completeOnboarding).toBe(true);
  });

  test('membership unknown: the picker stays, but onboarding is still skipped so settings are safe', () => {
    expect(decideReturningAccount({ ...fresh, settingsAreDefault: false, businessMember: null })).toEqual({
      returning: true,
      setAccountType: null,
      completeOnboarding: true,
    });
  });

  test('onboarding already complete is not recorded again', () => {
    expect(decideReturningAccount({ ...fresh, settingsAreDefault: false, onboardingComplete: true }).completeOnboarding).toBe(false);
  });
});

describe('resolveReturningAccount', () => {
  function deps(over: Partial<ReturningAccountDeps> = {}) {
    const log: string[] = [];
    const d: ReturningAccountDeps = {
      pulled: true,
      settingsAreDefault: async () => false,
      isBusinessMember: async () => {
        log.push('asked business');
        return false;
      },
      storedAccountType: async () => null,
      isOnboardingComplete: async () => false,
      saveAccountType: async (type: AccountType) => {
        log.push(`saved ${type}`);
      },
      markOnboardingComplete: async () => {
        log.push('onboarding complete');
      },
      ...over,
    };
    return { d, log };
  }

  test('records onboarding, then the profile, for a returning personal account', async () => {
    const { d, log } = deps();
    await resolveReturningAccount(d);
    expect(log).toEqual(['asked business', 'onboarding complete', 'saved personal']);
  });

  test('does not ask the server about a business when a profile is already recorded', async () => {
    const { d, log } = deps({ storedAccountType: async () => 'business' });
    await resolveReturningAccount(d);
    expect(log).toEqual(['onboarding complete']);
  });

  test('a failed business check is "unknown", not "personal"', async () => {
    const { d, log } = deps({
      isBusinessMember: async () => {
        throw new Error('offline');
      },
    });
    const decision = await resolveReturningAccount(d);
    expect(decision.setAccountType).toBeNull();
    expect(log).toEqual(['onboarding complete']);
  });

  test('without the first pull it reads and records nothing', async () => {
    let read = false;
    const { d, log } = deps({
      pulled: false,
      settingsAreDefault: async () => {
        read = true;
        return false;
      },
    });
    await resolveReturningAccount(d);
    expect(read).toBe(false);
    expect(log).toEqual([]);
  });
});
