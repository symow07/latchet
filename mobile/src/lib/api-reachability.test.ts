import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every API client function must be reachable from the UI.
 *
 * `setAccountSharing` shipped with no caller anywhere. The endpoint existed,
 * was tested, and enforced ownership and membership correctly — and there was
 * no way for a user to reach any of it. The "joint account" half of household
 * sharing was, from the outside, simply absent.
 *
 * Typecheck cannot see this: an exported function with no callers is valid
 * TypeScript. Neither can the backend suite, which tests the route it serves.
 * The gap is between the two, which is where this looks.
 */

const CLIENTS = ['householdApi.ts', 'accountApi.ts', 'businessApi.ts'];

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourcesUnder(full);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.includes('.test.') ? [full] : [];
  });
}

test('no API client function is dead code', () => {
  const lib = import.meta.dir;
  const root = join(lib, '..');

  // Everything the app could call from, minus the client modules themselves.
  const callers = [...sourcesUnder(join(root, 'app')), ...sourcesUnder(join(root, 'components')),
                   ...sourcesUnder(lib)]
    .filter((f) => !CLIENTS.some((c) => f.endsWith(c)))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  const unreachable: string[] = [];
  for (const client of CLIENTS) {
    const source = readFileSync(join(lib, client), 'utf8');
    for (const m of source.matchAll(/export async function (\w+)/g)) {
      const name = m[1]!;
      if (!new RegExp(`\\b${name}\\b`).test(callers)) unreachable.push(`${client}: ${name}`);
    }
  }

  expect(unreachable).toEqual([]);
});
