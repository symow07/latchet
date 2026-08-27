/**
 * Turning the personal profile into advisor context.
 *
 * Pure and native-free so it can be tested exhaustively — the important
 * assertions here are about what the string does NOT contain.
 *
 * The framing matters as much as the content. Health facts are introduced as
 * things that shape what the user's life COSTS, never as things the advisor
 * should reason about medically. "Coeliac" arrives as a reason gluten-free
 * staples appear on the grocery line, not as a condition to advise on. The
 * server-side hard constraints are the real enforcement; this is the half that
 * makes the model's job easy rather than adversarial.
 */

export interface ProfileForPrompt {
  householdSize?: number | null;
  city?: string | null;
  cookingHabits?: string | null;
  goals?: string | null;
  activityInterests?: string | null;
  dietaryPreferences?: string | null;
  allergies?: string | null;
  healthConsiderations?: string | null;
  sensitiveConsentAt?: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length > 0 ? t.slice(0, 300) : null;
};

/**
 * Returns '' when there is nothing to say, so the caller can concatenate
 * unconditionally without producing an empty labelled section.
 */
export function buildProfileContext(profile: ProfileForPrompt | null | undefined): string {
  if (!profile) return '';

  const lines: string[] = [];

  const size = profile.householdSize;
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
    lines.push(`- Household of ${Math.min(Math.round(size), 30)}`);
  }
  const city = clean(profile.city);
  if (city) lines.push(`- Lives in ${city} (use local prices where you know them)`);

  const cooking = clean(profile.cookingHabits);
  if (cooking) lines.push(`- Cooking habits: ${cooking}`);

  const goals = clean(profile.goals);
  if (goals) lines.push(`- Goals: ${goals}`);

  const activities = clean(profile.activityInterests);
  if (activities) lines.push(`- Interests that cost money: ${activities}`);

  const diet = clean(profile.dietaryPreferences);
  if (diet) {
    lines.push(
      `- Dietary preferences: ${diet}. Relevant ONLY because it changes what a weekly shop costs.`
    );
  }

  // The sensitive tier is gated on its own consent at render time as well as
  // at write time. A row that somehow held values without consent — an older
  // build, a restored backup — must not surface them.
  if (profile.sensitiveConsentAt) {
    const allergies = clean(profile.allergies);
    const conditions = clean(profile.healthConsiderations);
    if (allergies || conditions) {
      const parts = [allergies && `allergies: ${allergies}`, conditions && `considerations: ${conditions}`]
        .filter(Boolean)
        .join('; ');
      lines.push(
        `- Health context affecting cost — ${parts}. Use this ONLY to explain why ` +
        `certain categories run higher than typical and how to budget for that. ` +
        `Do not name products, do not say what is safe or unsafe, do not advise medically.`
      );
    }
  }

  if (lines.length === 0) return '';

  return `ABOUT THIS HOUSEHOLD (supplied by the user, for cost context only):
${lines.join('\n')}`;
}

/** True when the profile would contribute nothing, so the UI can say so. */
export function profileIsEmpty(profile: ProfileForPrompt | null | undefined): boolean {
  return buildProfileContext(profile) === '';
}
