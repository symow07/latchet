/**
 * Turning a company-profile PATCH into the fields to write.
 *
 * Split out of the route so the three-way distinction can be tested without a
 * database, because it is the part that is easy to get wrong:
 *
 *   absent  → leave the stored value alone
 *   ""/null → clear the stored value
 *   text    → trim and store
 *
 * Collapsing the first two is the classic bug: a screen that sends only the
 * field it edited would wipe every other field, and a screen that sends all of
 * them would make clearing impossible.
 */

export interface BusinessProfilePatch {
  name?: string;
  address?: string | null;
  vatNumber?: string | null;
  taxId?: string | null;
  fiscalYearStartMonth?: number | null;
}

export interface BusinessProfileFields {
  name?: string;
  address?: string | null;
  vatNumber?: string | null;
  taxId?: string | null;
  fiscalYearStartMonth?: number | null;
}

/** Trimmed text, or null when the field was emptied. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function buildBusinessProfileFields(patch: BusinessProfilePatch): BusinessProfileFields {
  const fields: BusinessProfileFields = {};

  // The one field that cannot be cleared. Every screen renders the company
  // name, and an empty one shows up as a blank header rather than an error.
  const name = patch.name?.trim();
  if (name) fields.name = name;

  if (patch.address !== undefined) fields.address = text(patch.address);
  if (patch.vatNumber !== undefined) fields.vatNumber = text(patch.vatNumber);
  if (patch.taxId !== undefined) fields.taxId = text(patch.taxId);
  if (patch.fiscalYearStartMonth !== undefined) {
    fields.fiscalYearStartMonth = patch.fiscalYearStartMonth ?? null;
  }

  return fields;
}
