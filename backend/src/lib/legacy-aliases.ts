/**
 * Response aliases for app builds that predate the Group rename.
 *
 * A backend deploy is instant; an app build is not. The schema rename went out
 * on 27 August and renamed three fields that shipped builds read:
 *
 *   members     was  teamMembers
 *   groupId     was  businessId
 *   ownedGroups was  ownedBusiness   (and changed shape — see me.ts)
 *
 * The first one crashed the app outright. `business?.teamMembers.find(...)`
 * optional-chains the business, not the list, so an absent `teamMembers` threw
 * on the business dashboard — the first screen in business mode. Every launch,
 * every time.
 *
 * This is the same version-skew lesson as readMembers/roleOf on the client,
 * learned from the other end: the client fix protects builds released AFTER
 * it, and does nothing for the ones already on people's phones. Only the
 * server can reach those.
 *
 * REMOVING THIS: safe once no build older than 28 August 2026 is in use. That
 * means the App Store version, not the newest one — check the oldest version
 * still reporting in, and delete this with its test.
 */

/** New name -> the name older builds read. */
const ALIASES: Record<string, string> = {
  members: "teamMembers",
  groupId: "businessId",
};

/**
 * Add the old field names alongside the new ones, recursively.
 *
 * Additive only: nothing is renamed or removed, so current builds see exactly
 * what they saw before and older ones find what they are looking for. An alias
 * is never written over a key that already exists.
 */
export function withLegacyAliases<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => withLegacyAliases(item)) as unknown as T;
  }
  // Date and other class instances must pass through untouched — spreading one
  // into a plain object turns it into {} on the wire.
  if (payload === null || typeof payload !== "object" || payload instanceof Date) {
    return payload;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    out[key] = withLegacyAliases(value);
  }
  for (const [current, legacy] of Object.entries(ALIASES)) {
    if (current in out && !(legacy in out)) {
      out[legacy] = out[current];
    }
  }
  return out as unknown as T;
}
