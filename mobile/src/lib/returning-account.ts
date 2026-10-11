/**
 * A returning account on a fresh database: don't ask it who it is.
 *
 * Signing out deletes the phone's per-user keys — the personal/business
 * choice and the onboarding flag among them — and a reinstall loses them too.
 * Without this, an account signing back in would meet the profile picker and
 * then onboarding again, and onboarding's settings write, stamped as a fresh
 * edit, would overwrite the settings it already has on the server.
 *
 * So once activation's first full pull has landed, the account is judged by
 * what the server holds:
 *   - its settings row is not epoch-dated: someone configured this account,
 *     so onboarding is done and is skipped (decision 6 — a row nobody edited
 *     carries the epoch);
 *   - it belongs to a business (owner or member): it is a business account;
 *     otherwise a configured account is a personal one.
 * A choice already recorded on this device is never overridden, and nothing
 * is decided without the pull — an account the device knows nothing about is
 * treated as new, as before.
 *
 * The rules and their orchestration import nothing (types only), so `bun test`
 * holds them (returning-account.test.ts); restoreReturningAccount, at the
 * bottom, binds them to the app's stores with lazy imports. The root layout
 * calls it after the first pull, and the profile picker once more if that
 * pull had not finished when the picker showed.
 */
import type { AccountType } from './account-type-store';

export interface ReturningAccountFacts {
  /** Activation's first full pull completed. Without it nothing is known. */
  pulled: boolean;
  /** After that pull, the settings row still carries the epoch: nobody ever configured it. */
  settingsAreDefault: boolean;
  /** The account belongs to a business; null when that could not be asked. */
  businessMember: boolean | null;
  /** The profile already recorded on this device. */
  storedAccountType: AccountType | null;
  /** Onboarding already recorded as complete on this device. */
  onboardingComplete: boolean;
}

export interface ReturningAccountDecision {
  /** The server says this account has been here before. */
  returning: boolean;
  /** Record this profile instead of showing the picker; null leaves it to the picker. */
  setAccountType: AccountType | null;
  /** Record onboarding as complete, so it is skipped. */
  completeOnboarding: boolean;
}

const NOTHING: ReturningAccountDecision = { returning: false, setAccountType: null, completeOnboarding: false };

export function decideReturningAccount(facts: ReturningAccountFacts): ReturningAccountDecision {
  if (!facts.pulled) return NOTHING;

  const configured = !facts.settingsAreDefault;
  const returning = configured || facts.businessMember === true;
  if (!returning) return NOTHING;

  let setAccountType: AccountType | null = null;
  if (!facts.storedAccountType) {
    if (facts.businessMember === true) setAccountType = 'business';
    // Configured, and certainly not in a business. If the business question
    // could not be answered, the picker stays: guessing "personal" would put
    // a business owner on the wrong tabs. Onboarding is still skipped below,
    // so whichever they pick, their settings are safe.
    else if (facts.businessMember === false) setAccountType = 'personal';
  }

  return {
    returning: true,
    setAccountType,
    completeOnboarding: configured && !facts.onboardingComplete,
  };
}

/** The effects resolveReturningAccount needs, supplied by the app (and by tests). */
export interface ReturningAccountDeps {
  /** True if activation's first full pull completed. */
  pulled: boolean;
  settingsAreDefault: () => Promise<boolean>;
  /** Resolves true/false; rejects (or resolves null) when the server cannot say. */
  isBusinessMember: () => Promise<boolean | null>;
  storedAccountType: () => Promise<AccountType | null>;
  isOnboardingComplete: () => Promise<boolean>;
  saveAccountType: (type: AccountType) => Promise<void>;
  markOnboardingComplete: () => Promise<void>;
}

/**
 * Gather the facts, decide, and record the decision. The business question is
 * only asked when it can change something (no profile recorded yet).
 */
export async function resolveReturningAccount(deps: ReturningAccountDeps): Promise<ReturningAccountDecision> {
  if (!deps.pulled) return NOTHING;

  const [settingsAreDefault, storedAccountType, onboardingComplete] = await Promise.all([
    deps.settingsAreDefault(),
    deps.storedAccountType(),
    deps.isOnboardingComplete(),
  ]);
  let businessMember: boolean | null = null;
  if (!storedAccountType) {
    try {
      businessMember = await deps.isBusinessMember();
    } catch {
      businessMember = null;
    }
  }

  const decision = decideReturningAccount({
    pulled: true,
    settingsAreDefault,
    businessMember,
    storedAccountType,
    onboardingComplete,
  });
  // Onboarding first: once the profile is set the app may route straight on.
  if (decision.completeOnboarding) await deps.markOnboardingComplete();
  if (decision.setAccountType) await deps.saveAccountType(decision.setAccountType);
  return decision;
}

/** The business question must not hold up sign-in for long. */
const BUSINESS_CHECK_TIMEOUT_MS = 8_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * The app's side: run the decision for `userId` against the real stores, once
 * their first pull has (or has not) completed. Imports lazily, so the rules
 * above load under `bun test` without React Native. Every write checks the
 * user is still the active one — a sign-out while the business question was
 * in flight must not record a profile for whoever comes next.
 */
export async function restoreReturningAccount(userId: string, pulled: boolean): Promise<ReturningAccountDecision> {
  if (!pulled) return NOTHING;
  const [db, business, accountType, onboarding] = await Promise.all([
    import('./db'),
    import('./businessApi'),
    import('./account-type-store'),
    import('./onboarding-storage'),
  ]);
  const stillActive = () => db.activeUserId() === userId;
  return resolveReturningAccount({
    pulled: stillActive(),
    settingsAreDefault: db.isSettingsDefault,
    isBusinessMember: async () => (await within(business.getBusiness(), BUSINESS_CHECK_TIMEOUT_MS)) !== null,
    storedAccountType: () => accountType.readStoredAccountType(userId),
    isOnboardingComplete: onboarding.isOnboardingComplete,
    saveAccountType: async (type) => {
      if (stillActive()) await accountType.useAccountTypeStore.getState().save(userId, type);
    },
    markOnboardingComplete: async () => {
      if (stillActive()) await onboarding.markOnboardingComplete();
    },
  });
}
