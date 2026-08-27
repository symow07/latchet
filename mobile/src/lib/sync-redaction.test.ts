import { test, expect } from 'bun:test';
import { redactDeviceOnly, isDeviceOnlyField } from './sync-redaction';
import { PROFILE_FIELDS, SENSITIVE_FIELDS } from './health-profile';

test('every profile field this app stores is recognised as device-only', () => {
  // Bound to the real field list, so adding a profile column without adding a
  // pattern fails here rather than shipping.
  const unprotected = PROFILE_FIELDS.filter((f) => !isDeviceOnlyField(f));
  // City, household size and goals are not health data — they are ordinary
  // context and are allowed to sync if they ever need to. The sensitive tier
  // is not.
  expect(unprotected).toEqual(['householdSize', 'city', 'goals']);
  for (const field of SENSITIVE_FIELDS) expect(isDeviceOnlyField(field)).toBe(true);
});

test('a health field on the settings row is stripped, not uploaded', () => {
  // The realistic mistake: someone adds the profile to `settings`, which
  // cloud-sync spreads wholesale into PUT /api/settings.
  const settings = {
    monthlyBudget: 1200,
    currency: 'USD',
    allergies: 'peanuts',
    healthConsiderations: 'type 2 diabetes',
    dietaryPreferences: 'coeliac',
  };
  const sent = redactDeviceOnly(settings);
  const serialised = JSON.stringify(sent);
  expect(serialised).not.toContain('peanuts');
  expect(serialised).not.toContain('diabetes');
  expect(serialised).not.toContain('coeliac');
  expect(sent).toMatchObject({ monthlyBudget: 1200, currency: 'USD' });
});

test('a nested health field is stripped too', () => {
  const payload = { settings: { profile: { allergies: 'peanuts' }, currency: 'USD' } };
  expect(JSON.stringify(redactDeviceOnly(payload))).not.toContain('peanuts');
});

test('arrays are traversed', () => {
  const payload = [{ id: 't1', allergies: 'peanuts' }, { id: 't2', amount: 4 }];
  const out = JSON.stringify(redactDeviceOnly(payload));
  expect(out).not.toContain('peanuts');
  expect(out).toContain('t2');
});

test('ordinary payloads pass through unchanged', () => {
  const tx = [{ id: 't1', amount: 12.5, category: 'Food', note: 'lunch', dateISO: '2026-08-27' }];
  expect(redactDeviceOnly(tx)).toEqual(tx);
});

test('primitives and null survive', () => {
  expect(redactDeviceOnly(null)).toBeNull();
  expect(redactDeviceOnly(4)).toBe(4);
  expect(redactDeviceOnly('x')).toBe('x');
  expect(redactDeviceOnly(undefined)).toBeUndefined();
});

test('matching is case-insensitive', () => {
  expect(isDeviceOnlyField('Allergies')).toBe(true);
  expect(isDeviceOnlyField('ALLERGIES')).toBe(true);
  expect(isDeviceOnlyField('userAllergyNotes')).toBe(true);
});

test('every outbound sync payload is redacted at the call site', async () => {
  // Asserting the wiring, not just the function. A redactor nothing calls is
  // the failure mode this whole module exists to prevent.
  const source = await Bun.file(new URL('./cloud-sync.ts', import.meta.url)).text();
  const push = source.slice(
    source.indexOf('export async function pushLocalDataToCloud'),
    source.indexOf('async function fetchAllCloudTransactions')
  );

  const calls = [...push.matchAll(/api\.(post|put|patch)\(\s*'[^']+'\s*,\s*([\s\S]{0,20})/g)];
  expect(calls.length).toBeGreaterThan(0);
  for (const [, , afterComma] of calls) {
    expect(afterComma).toContain('redactDeviceOnly');
  }
});

test('account deletion clears the device-only advisor profile', async () => {
  // The server cascade cannot reach local SQLite, so deleting the account
  // would otherwise strand a health profile belonging to an account that no
  // longer exists.
  const source = await Bun.file(
    new URL('../components/DeleteAccountModal.tsx', import.meta.url)
  ).text();
  const handler = source.slice(source.indexOf('const result = await deleteAccount('));
  expect(handler).toContain('deleteHealthProfile');
  // Before the success callback, not after some later render.
  expect(handler.indexOf('deleteHealthProfile')).toBeLessThan(handler.indexOf('onDeleted('));
});
