/**
 * A net-worth breakdown's two shapes: the JSON text it is stored and synced
 * as (I-WIRE-4), and the object of amounts everything else reads. Imports
 * nothing, so the backend's end-to-end test can use it as the phone does.
 */

/** Amounts by name. */
export type Breakdown = Record<string, number>;

/**
 * A stored breakdown as an object, or null when there is none or it is not
 * one. Anything in it that is not a finite number is left out, rather than
 * shown as NaN.
 */
export function parseBreakdown(text: string | null | undefined): Breakdown | null {
  if (typeof text !== 'string' || text === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Breakdown = {};
  for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
    if (typeof amount === 'number' && Number.isFinite(amount)) out[key] = amount;
  }
  return out;
}

/** A breakdown as stored and sent: JSON text, or null when it holds nothing. */
export function serializeBreakdown(breakdown: Breakdown | null | undefined): string | null {
  if (!breakdown) return null;
  const kept = Object.entries(breakdown).filter(([, v]) => Number.isFinite(v));
  return kept.length === 0 ? null : JSON.stringify(Object.fromEntries(kept));
}
