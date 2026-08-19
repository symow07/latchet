import { test, expect } from 'bun:test';
import {
  headerSignature,
  matchProfile,
  upsertProfile,
  removeProfile,
  MAX_PROFILES,
  type ImportProfile,
} from './import-profiles';
import { emptyMapping, type CsvFormat } from './import-parser';

const FORMAT: CsvFormat = {
  decimal: 'european',
  date: 'dmy',
  sign: 'signed',
  dateAmbiguous: false,
  signAmbiguous: false,
  decimalAmbiguous: false,
};

const profile = (over: Partial<ImportProfile> = {}): ImportProfile => ({
  signature: 'date|libelle|montant',
  headers: ['Date', 'Libellé', 'Montant'],
  mapping: { ...emptyMapping(), dateIdx: 0, descIdx: 1, amountIdx: 2 },
  format: FORMAT,
  updatedAt: '2026-08-01T00:00:00.000Z',
  useCount: 1,
  ...over,
});

test('the same bank matches across trivial header differences', () => {
  // Casing, padding and accents differ between exports from the same bank.
  const a = headerSignature(['Date', 'Libellé', 'Montant']);
  const b = headerSignature([' date ', 'LIBELLE', 'montant']);
  expect(a).toBe(b);
});

test('a trailing empty column does not change the signature', () => {
  // Plenty of banks emit a stray trailing comma.
  expect(headerSignature(['Date', 'Amount', ''])).toBe(headerSignature(['Date', 'Amount']));
});

test('different banks never share a signature', () => {
  expect(headerSignature(['Date', 'Libellé', 'Montant'])).not.toBe(
    headerSignature(['Buchungstag', 'Verwendungszweck', 'Betrag'])
  );
});

test('column order is part of the identity', () => {
  expect(headerSignature(['Date', 'Amount'])).not.toBe(headerSignature(['Amount', 'Date']));
});

test('a saved profile is found again by its headers', () => {
  const saved = [profile()];
  const found = matchProfile(saved, ['Date', 'Libellé', 'Montant']);

  expect(found?.format.decimal).toBe('european');
  expect(found?.mapping.amountIdx).toBe(2);
});

test('an unknown bank matches nothing', () => {
  expect(matchProfile([profile()], ['Buchungstag', 'Betrag'])).toBeNull();
});

test('re-importing from the same bank updates rather than duplicates', () => {
  const first = upsertProfile([], profile(), new Date('2026-08-01T00:00:00Z'));
  const second = upsertProfile(first, profile(), new Date('2026-08-02T00:00:00Z'));

  expect(second).toHaveLength(1);
  expect(second[0]!.useCount).toBe(2);
  expect(second[0]!.updatedAt).toBe('2026-08-02T00:00:00.000Z');
});

test('the most recently used profile sorts first', () => {
  let profiles = upsertProfile([], profile({ signature: 'a', headers: ['A'] }), new Date('2026-08-01T00:00:00Z'));
  profiles = upsertProfile(profiles, profile({ signature: 'b', headers: ['B'] }), new Date('2026-08-02T00:00:00Z'));

  expect(profiles.map((p) => p.signature)).toEqual(['b', 'a']);
});

test('the store is bounded, and never evicts the profile being saved', () => {
  let profiles: ImportProfile[] = [];
  for (let i = 0; i < MAX_PROFILES + 5; i++) {
    profiles = upsertProfile(
      profiles,
      profile({ signature: `bank-${i}`, headers: [`H${i}`] }),
      new Date(Date.UTC(2026, 0, 1, 0, i))
    );
  }

  expect(profiles).toHaveLength(MAX_PROFILES);
  expect(profiles[0]!.signature).toBe(`bank-${MAX_PROFILES + 4}`);
  // The oldest is the one that went.
  expect(profiles.some((p) => p.signature === 'bank-0')).toBe(false);
});

test('a profile can be forgotten', () => {
  const profiles = [profile({ signature: 'a' }), profile({ signature: 'b' })];
  expect(removeProfile(profiles, 'a').map((p) => p.signature)).toEqual(['b']);
});
