/**
 * Remembered per-bank import formats.
 *
 * A statement's shape — which column is the date, whether commas are decimal
 * points, whether an unsigned amount means spending — is a property of the
 * bank, not of the individual file. Once the user has told us (or detection has
 * worked it out and the user has accepted the preview), the next export from
 * the same bank should just work.
 *
 * Profiles are keyed by a signature of the header row, so the match is exact
 * and cheap, and two banks can never be confused for each other.
 *
 * The pure functions here import nothing native so they can be unit-tested;
 * AsyncStorage is pulled in lazily inside the two persistence functions, which
 * keeps this module loadable outside React Native.
 */
import type { ColumnMapping, CsvFormat } from './import-parser';
import { userKey } from './storage-keys';

/** Per user (storage-keys.ts): a bank's export format is part of that user's setup. */
const STORAGE_KEY = '@import_profiles_v1';

/** How many profiles to keep. Well beyond the number of banks anyone uses. */
export const MAX_PROFILES = 25;

export interface ImportProfile {
  /** Stable key derived from the header row. */
  signature: string;
  /** The header row as the bank wrote it, for display. */
  headers: string[];
  mapping: ColumnMapping;
  format: CsvFormat;
  /** ISO timestamp of the last import that used this profile. */
  updatedAt: string;
  useCount: number;
}

/**
 * Stable key for a header row.
 *
 * Normalised so trivial differences between two exports from the same bank —
 * casing, padding, accents, a trailing empty column — still match.
 */
export function headerSignature(headers: string[]): string {
  return headers
    .map((h) =>
      (h ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((h, i, all) => h !== '' || i < all.length - 1)
    .join('|');
}

/** Find the profile matching a header row, if one has been saved. */
export function matchProfile(
  profiles: ImportProfile[],
  headers: string[]
): ImportProfile | null {
  const signature = headerSignature(headers);
  return profiles.find((p) => p.signature === signature) ?? null;
}

/**
 * Insert or update a profile, newest first, bounded.
 *
 * Pure so the eviction rule is testable: the least recently used profile is
 * dropped, never the one being saved.
 */
export function upsertProfile(
  profiles: ImportProfile[],
  profile: Omit<ImportProfile, 'updatedAt' | 'useCount'>,
  now: Date = new Date()
): ImportProfile[] {
  const existing = profiles.find((p) => p.signature === profile.signature);
  const merged: ImportProfile = {
    ...profile,
    updatedAt: now.toISOString(),
    useCount: (existing?.useCount ?? 0) + 1,
  };

  const rest = profiles.filter((p) => p.signature !== profile.signature);
  return [merged, ...rest]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_PROFILES);
}

export function removeProfile(
  profiles: ImportProfile[],
  signature: string
): ImportProfile[] {
  return profiles.filter((p) => p.signature !== signature);
}

// ── Persistence ──────────────────────────────────────────────────────────────

async function storage() {
  // Imported lazily so the pure logic above stays testable outside RN.
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

export async function loadProfiles(): Promise<ImportProfile[]> {
  try {
    const AsyncStorage = await storage();
    const raw = await AsyncStorage.getItem(userKey(STORAGE_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ImportProfile[]) : [];
  } catch {
    // A corrupt profile store must never block an import.
    return [];
  }
}

export async function saveProfiles(profiles: ImportProfile[]): Promise<void> {
  try {
    const AsyncStorage = await storage();
    await AsyncStorage.setItem(userKey(STORAGE_KEY), JSON.stringify(profiles));
  } catch {
    /* remembering is a convenience, never a requirement */
  }
}

/** Look up the remembered format for a header row. */
export async function findProfileFor(headers: string[]): Promise<ImportProfile | null> {
  return matchProfile(await loadProfiles(), headers);
}

/** Remember the format used for a successful import. */
export async function rememberProfile(
  headers: string[],
  mapping: ColumnMapping,
  format: CsvFormat
): Promise<void> {
  const profiles = await loadProfiles();
  await saveProfiles(
    upsertProfile(profiles, {
      signature: headerSignature(headers),
      headers,
      mapping,
      format,
    })
  );
}
