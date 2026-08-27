/**
 * Fields that must never leave the device through cloud sync.
 *
 * The health profile lives in its own table, so today nothing in
 * pushLocalDataToCloud reads it — it is excluded by construction. This module
 * exists because "by construction" is a property of the code as it stands, and
 * the code will not stand still.
 *
 * The specific way it would break: pushLocalDataToCloud spreads the whole
 * settings row into PUT /api/settings. Anyone who later stores a health field
 * on `settings` — the obvious place to put it, if you did not know — uploads
 * it without writing a line of code that sends it. This turns that from a
 * silent leak into a stripped field and a failing test.
 */

/** Case-insensitive substrings. A field whose name contains one is dropped. */
export const DEVICE_ONLY_FIELD_PATTERNS = [
  'allerg',
  'healthconsideration',
  'healthprofile',
  'dietary',
  'cookinghabit',
  'activityinterest',
  'medical',
  'condition',
] as const;

export function isDeviceOnlyField(key: string): boolean {
  const k = key.toLowerCase();
  return DEVICE_ONLY_FIELD_PATTERNS.some((p) => k.includes(p));
}

/**
 * Strip device-only fields from anything about to be sent to the backend.
 *
 * Recurses, because a payload is not always flat and a nested object is
 * exactly where such a field would hide from a shallow check.
 */
export function redactDeviceOnly<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => redactDeviceOnly(item)) as unknown as T;
  }
  if (payload && typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (isDeviceOnlyField(key)) continue;
      out[key] = redactDeviceOnly(value);
    }
    return out as unknown as T;
  }
  return payload;
}
