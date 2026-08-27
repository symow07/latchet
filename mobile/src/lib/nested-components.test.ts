import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No screen may declare a component inside another component's body.
 *
 * A component declared in a render body is a new function identity every
 * render, so React unmounts and remounts it instead of updating it. For a
 * subtree containing a TextInput that means the keyboard loses its target on
 * the first keystroke: typing "peanuts" leaves "P" in the field, because the
 * first character sets state, the re-render swaps the component type, and the
 * input the keyboard was attached to no longer exists.
 *
 * That shipped in advisor-profile.tsx and was found by typing into the
 * simulator, not by reading the code — which is exactly why this is a test.
 */
test('no component is declared inside another component', () => {
  const root = join(import.meta.dir, '..', 'app');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []
    );

  const offenders: string[] = [];
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8');
    source.split('\n').forEach((line, i) => {
      // Indented (so: inside something) capitalised arrow component.
      if (/^\s+const [A-Z][A-Za-z0-9]*\s*=\s*\(\{[^}]*\}\s*:/.test(line)) {
        offenders.push(`${file.split('/').slice(-2).join('/')}:${i + 1}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});
