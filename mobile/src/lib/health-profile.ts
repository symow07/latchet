/**
 * The advisor's personal profile.
 *
 * DEVICE-ONLY. This never reaches the backend's database, is never in
 * /api/settings, and is excluded from cloud sync by construction and again by
 * an explicit filter. A breach of the backend exposes no health data from this
 * app because there is none there — a stronger position than encrypting it
 * well, and the reason the storage decision came before the feature.
 *
 * It DOES travel to OpenAI inside the advisor prompt when the user asks the
 * advisor something. That is disclosed at the consent screen and in
 * PRIVACY.md; it is not a secret, it is a different threat model.
 *
 * Two tiers, consented separately:
 *
 *   standard   household size, city, cooking habits, goals, activity
 *              interests, dietary preferences. Not sensitive under GDPR.
 *   sensitive  allergies and health considerations. Article 9 special
 *              category data, and PIPL sensitive personal information. Both
 *              require explicit, separate consent — so it has its own flag,
 *              its own screen, and its own timestamp.
 *
 * The standard tier alone carries most of the value. That is stated at the
 * consent point so nobody feels pushed into the sensitive tier to get a decent
 * experience.
 */
// getDatabase is imported lazily inside each function, the way import-profiles does
// it, so the field lists and consent rules above stay reachable from `bun test`
// without dragging expo-sqlite and react-native into the module graph.

export interface HealthProfile {
  householdSize: number | null;
  city: string | null;
  cookingHabits: string | null;
  goals: string | null;
  activityInterests: string | null;
  dietaryPreferences: string | null;
  /** Sensitive tier. Only ever populated with sensitiveConsentAt set. */
  allergies: string | null;
  healthConsiderations: string | null;
  standardConsentAt: string | null;
  sensitiveConsentAt: string | null;
  updatedAt: string | null;
}

export const EMPTY_PROFILE: HealthProfile = {
  householdSize: null, city: null, cookingHabits: null, goals: null,
  activityInterests: null, dietaryPreferences: null,
  allergies: null, healthConsiderations: null,
  standardConsentAt: null, sensitiveConsentAt: null, updatedAt: null,
};

/** Field names that must never leave the device except in an advisor prompt. */
export const SENSITIVE_FIELDS = ['allergies', 'healthConsiderations'] as const;
export const PROFILE_FIELDS = [
  'householdSize', 'city', 'cookingHabits', 'goals', 'activityInterests',
  'dietaryPreferences', ...SENSITIVE_FIELDS,
] as const;

export async function getHealthProfile(): Promise<HealthProfile> {
  const { getDatabase } = await import('./db');
  const db = await getDatabase();
  const row = await db.getFirstAsync<HealthProfile>('SELECT * FROM health_profile WHERE id = 1');
  return row ? { ...EMPTY_PROFILE, ...row } : { ...EMPTY_PROFILE };
}

export async function saveHealthProfile(patch: Partial<HealthProfile>): Promise<void> {
  const current = await getHealthProfile();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };

  // Sensitive fields cannot be written without the sensitive consent recorded.
  // Enforced here rather than at the screen so a future caller cannot bypass
  // it by forgetting.
  if (!next.sensitiveConsentAt) {
    next.allergies = null;
    next.healthConsiderations = null;
  }

  // Through the write queue, so this never lands inside another write's
  // transaction on the shared connection. Device-only: no sync bookkeeping.
  const { withWriteLock } = await import('./db');
  await withWriteLock((db) => db.runAsync(
    `INSERT INTO health_profile
       (id, householdSize, city, cookingHabits, goals, activityInterests,
        dietaryPreferences, allergies, healthConsiderations,
        standardConsentAt, sensitiveConsentAt, updatedAt)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       householdSize = excluded.householdSize, city = excluded.city,
       cookingHabits = excluded.cookingHabits, goals = excluded.goals,
       activityInterests = excluded.activityInterests,
       dietaryPreferences = excluded.dietaryPreferences,
       allergies = excluded.allergies,
       healthConsiderations = excluded.healthConsiderations,
       standardConsentAt = excluded.standardConsentAt,
       sensitiveConsentAt = excluded.sensitiveConsentAt,
       updatedAt = excluded.updatedAt`,
    [
      next.householdSize, next.city, next.cookingHabits, next.goals,
      next.activityInterests, next.dietaryPreferences,
      next.allergies, next.healthConsiderations,
      next.standardConsentAt, next.sensitiveConsentAt, next.updatedAt,
    ]
  ));
}

/**
 * One tap, gone. Deletes the row outright rather than nulling columns, so
 * nothing is left to recover — which is what "delete my health profile" has to
 * mean if the button is going to claim it.
 */
export async function deleteHealthProfile(): Promise<void> {
  const { withWriteLock } = await import('./db');
  await withWriteLock((db) => db.runAsync('DELETE FROM health_profile WHERE id = 1'));
}

/** Withdrawing only the sensitive tier, keeping the rest. */
export async function revokeSensitiveConsent(): Promise<void> {
  const { withWriteLock } = await import('./db');
  await withWriteLock((db) => db.runAsync(
    `UPDATE health_profile
        SET allergies = NULL, healthConsiderations = NULL,
            sensitiveConsentAt = NULL, updatedAt = ?
      WHERE id = 1`,
    [new Date().toISOString()]
  ));
}
