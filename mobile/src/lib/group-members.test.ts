import { test, expect } from 'bun:test';
import { readMembers, roleOf } from './group-members';

const member = { userId: 'u1', role: 'owner' };

test('reads the current shape', () => {
  expect(readMembers({ members: [member] })).toEqual([member]);
});

test('reads the shape the backend sent before the rename', () => {
  // The case that produced a black screen: a device running the new build
  // against a backend that had not deployed yet.
  expect(readMembers({ teamMembers: [member] })).toEqual([member]);
});

test('prefers the current shape when a backend sends both', () => {
  const old = { userId: 'u2', role: 'employee' };
  expect(readMembers({ members: [member], teamMembers: [old] })).toEqual([member]);
});

test('an absent list is an empty array, never undefined', () => {
  // The whole point: `.find()` on the result must not throw. Every one of
  // these inputs crashed the previous call site.
  for (const input of [null, undefined, {}, { members: null }, { teamMembers: null },
                       { members: undefined }, { members: 'nonsense' as never }]) {
    const out = readMembers(input as never);
    expect(Array.isArray(out)).toBe(true);
    expect(() => out.find((m) => m.userId === 'x')).not.toThrow();
  }
});

test('roleOf finds the caller across both shapes', () => {
  expect(roleOf({ members: [member] }, 'u1')).toBe('owner');
  expect(roleOf({ teamMembers: [member] }, 'u1')).toBe('owner');
});

test('roleOf is undefined for a stranger, a null group, or no session', () => {
  expect(roleOf({ members: [member] }, 'nobody')).toBeUndefined();
  expect(roleOf(null, 'u1')).toBeUndefined();
  expect(roleOf({ members: [member] }, null)).toBeUndefined();
  expect(roleOf({ members: [member] }, undefined)).toBeUndefined();
});

test('no screen reads a member list directly off the group', async () => {
  // The black screen came from `business?.members.find(...)`, which reads as
  // safe and is not: the optional chain guards the group, not the list. Every
  // call site goes through readMembers/roleOf, which always return an array.
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = join(import.meta.dir, '..', 'app');

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []
    );

  const offenders: string[] = [];
  for (const file of walk(root)) {
    const source = await Bun.file(file).text();
    // `.members.` or `.teamMembers.` reached without going through a helper.
    for (const m of source.matchAll(/\??\.\s*(members|teamMembers)\s*\.\s*(find|map|filter|length|some|reduce)/g)) {
      offenders.push(`${file.split('/').slice(-2).join('/')}: ${m[0].trim()}`);
    }
  }
  expect(offenders).toEqual([]);
});
