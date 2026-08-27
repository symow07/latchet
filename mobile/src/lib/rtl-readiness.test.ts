import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Layout must be written in terms of start and end, not left and right.
 *
 * Yoga flips `flexDirection: 'row'` automatically in RTL. It does not flip
 * `marginLeft`: that margin stays on the left even when the row it sits in has
 * reversed, which is how an RTL layout ends up with every gap on the wrong
 * side of every element.
 *
 * 191 of these were converted in one pass across 28 files. Without a test the
 * next screen written re-introduces them and nobody notices until Arabic
 * ships, at which point it is 30 screens of manual work again.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) && !full.endsWith('.test.ts') ? [full] : [];
  });
}

const PHYSICAL_STYLE = /\b(marginLeft|marginRight|paddingLeft|paddingRight)\b/g;
// Tailwind's physical margin and padding utilities. ms-/me-/ps-/pe- are the
// logical ones, and react-native-css-interop maps them to RN's start/end.
const PHYSICAL_CLASS = /\b(ml|mr|pl|pr)-(\[?[\w./%-]+\]?)/g;

test('no screen positions itself with left or right', () => {
  const offenders: string[] = [];
  for (const file of [...walk('src/app'), ...walk('src/components')]) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(PHYSICAL_STYLE)) {
      offenders.push(`${file}: ${match[1]}`);
    }
    for (const match of source.matchAll(PHYSICAL_CLASS)) {
      offenders.push(`${file}: ${match[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});
