import { test, expect } from 'bun:test';
import { buildProfileContext, profileIsEmpty, type ProfileForPrompt } from './health-profile-prompt';

const full: ProfileForPrompt = {
  householdSize: 2,
  city: 'Casablanca',
  cookingHabits: 'cook most nights',
  goals: 'save for a deposit',
  activityInterests: 'climbing',
  dietaryPreferences: 'coeliac, halal',
  allergies: 'peanuts',
  healthConsiderations: 'type 2 diabetes',
  sensitiveConsentAt: '2026-08-27T10:00:00Z',
};

test('an empty profile contributes nothing at all', () => {
  expect(buildProfileContext(null)).toBe('');
  expect(buildProfileContext(undefined)).toBe('');
  expect(buildProfileContext({})).toBe('');
  expect(profileIsEmpty({})).toBe(true);
});

test('blank strings are not treated as answers', () => {
  expect(buildProfileContext({ city: '   ', goals: '', cookingHabits: '\n' })).toBe('');
});

test('the standard tier alone produces useful context', () => {
  const out = buildProfileContext({ householdSize: 2, city: 'Casablanca', dietaryPreferences: 'halal' });
  expect(out).toContain('Household of 2');
  expect(out).toContain('Casablanca');
  expect(out).toContain('halal');
});

// ── The gate that matters ────────────────────────────────────────────────────

test('sensitive fields never appear without their own consent', () => {
  // A row holding values with no consent timestamp: an older build, a restored
  // backup, a bug. It must not surface them whatever the reason.
  const withoutConsent = { ...full, sensitiveConsentAt: null };
  const out = buildProfileContext(withoutConsent);
  expect(out).not.toContain('peanut');
  expect(out).not.toContain('diabetes');
  // ...while the standard tier still works.
  expect(out).toContain('Casablanca');
  expect(out).toContain('coeliac');
});

test('with consent, health context is framed as cost and fenced with the constraints', () => {
  const out = buildProfileContext(full);
  expect(out).toContain('peanuts');
  expect(out).toContain('affecting cost');
  expect(out).toContain('Do not name products');
  expect(out).toContain('do not say what is safe or unsafe');
  expect(out).toContain('do not advise medically');
});

test('dietary preferences carry their cost framing too', () => {
  const out = buildProfileContext({ dietaryPreferences: 'vegetarian' });
  expect(out).toContain('changes what a weekly shop costs');
});

// ── Bounds ───────────────────────────────────────────────────────────────────

test('a free-text field cannot grow without limit', () => {
  // The prompt has a 20,000 character server cap; one field must not consume it.
  const out = buildProfileContext({ goals: 'x'.repeat(5000) });
  expect(out.length).toBeLessThan(400);
});

test('an implausible household size is clamped, not echoed', () => {
  expect(buildProfileContext({ householdSize: 999 })).toContain('Household of 30');
  expect(buildProfileContext({ householdSize: 0 })).toBe('');
  expect(buildProfileContext({ householdSize: -4 })).toBe('');
  expect(buildProfileContext({ householdSize: NaN })).toBe('');
  expect(buildProfileContext({ householdSize: Infinity })).toBe('');
});

test('a fractional household size is rounded rather than printed raw', () => {
  expect(buildProfileContext({ householdSize: 2.6 })).toContain('Household of 3');
});
