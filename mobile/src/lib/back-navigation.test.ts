import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every pushed screen must offer a way back.
 *
 * A tab needs no back control — the bar is the way out. A pushed screen has
 * only the gesture, which is invisible and which nobody discovers by accident.
 *
 * business-team.tsx shipped without one, because it had been a tab and moving
 * it into Settings did not change anything that would notice. That is the
 * shape of this bug: it is introduced by a move, not by writing a screen, so
 * reviewing the new screen does not catch it.
 */

/** Screens that are deliberately terminal: the flow forward IS the way out. */
const NO_BACK_BY_DESIGN = new Set([
  'login.tsx', 'signup.tsx',                     // auth: forward or nothing
  'onboarding.tsx', 'account-type.tsx',           // first run, one-way
  'index.tsx',                                    // the root
  '+not-found.tsx', '+html.tsx',
]);

test('every pushed screen has a back control', () => {
  const appDir = join(import.meta.dir, '..', 'app');
  const offenders: string[] = [];

  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    // Only top-level files: anything inside (tabs)/ or (business-tabs)/ is a
    // tab and reached from the bar.
    if (entry.isDirectory() || !entry.name.endsWith('.tsx')) continue;
    if (entry.name === '_layout.tsx' || NO_BACK_BY_DESIGN.has(entry.name)) continue;

    // Import lines are stripped first: `import { ArrowLeft }` proves nothing
    // about whether the icon is rendered, and matching it made this test pass
    // against a screen whose back button I had just deleted.
    const source = readFileSync(join(appDir, entry.name), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*import\b/.test(line) && !/^\s{2,}[A-Za-z]+,\s*$/.test(line))
      .join('\n');

    const hasBack = /<(ArrowLeft|ChevronLeft)\b|router\.back\(\)/.test(source);
    if (!hasBack) offenders.push(entry.name);
  }

  expect(offenders).toEqual([]);
});
