import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every backend call must carry the session.
 *
 * `credentials: "include"` looks like it does this and does not: the mobile
 * auth-client uses the expoClient plugin with no bearerClient, and expo/fetch
 * does not share cookies from SecureStore. A call that relies on it is silently
 * unauthenticated, and the 401 that comes back reads as a logged-out user
 * rather than a missing header.
 *
 * That is not hypothetical. businessApi, budgetApi, expenseApi and salaryApi
 * all did exactly this — twenty calls — so the entire business feature had
 * never once reached the backend as a signed-in user. The business record was
 * never created at sign-up for the same reason, and every business screen sat
 * empty with no way to recover.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

test('no backend call uses bare fetch instead of authedFetch', () => {
  const offenders: string[] = [];
  for (const file of walk('src/lib')) {
    // The client itself is where the real fetch lives.
    if (file.endsWith('api/api.ts')) continue;
    const src = readFileSync(file, 'utf8');
    if (!/getBackendUrl|EXPO_PUBLIC_BACKEND_URL/.test(src)) continue;
    for (const m of src.matchAll(/(?<![.\w])fetch\s*\(/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${file}:${line}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('credentials:"include" is not used as if it authenticated a call', () => {
  // It attaches nothing here. Leaving it in place is what made twenty
  // unauthenticated calls look deliberate.
  const offenders: string[] = [];
  for (const file of walk('src/lib')) {
    const src = readFileSync(file, 'utf8');
    if (!/getBackendUrl|EXPO_PUBLIC_BACKEND_URL/.test(src)) continue;
    if (file.endsWith('api/api.ts')) continue;
    if (/credentials:\s*['"]include['"]/.test(src)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
