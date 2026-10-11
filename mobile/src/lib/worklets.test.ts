import { test, expect } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Everything a UI-thread body calls from this codebase must be a worklet.
 *
 * Gesture callbacks (.onBegin/.onUpdate/.onEnd/…) and the bodies of
 * useAnimatedStyle, useAnimatedProps, useAnimatedReaction and useDerivedValue
 * run on the UI thread. Calling one of our own functions there that lacks the
 * 'worklet' directive throws "Tried to synchronously call a non-worklet
 * function" — at runtime, on the first frame that reaches it, never at build
 * time. kit.tsx's timed() did exactly that: the Sheet's drag-to-dismiss froze
 * mid-gesture, because timed() was only ever exercised on the JS thread until
 * someone dragged.
 *
 * This reads each body, finds the calls it makes, resolves the ones defined in
 * this repo (in the same file or imported through '@/' or a relative path) and
 * requires 'worklet' as their first statement. Library functions (withTiming,
 * interpolate, runOnJS, Easing.*) are Reanimated's own worklets and are not
 * checked.
 */

const SRC = join(import.meta.dir, '..');
const ROOTS = [join(SRC, 'app'), join(SRC, 'components')];

const GESTURE_CALLBACK = /\.on(?:Begin|Start|Update|Change|End|Finalize|TouchesDown|TouchesMove|TouchesUp|TouchesCancelled)\(/g;
const ANIMATED_HOOK = /\buse(?:AnimatedStyle|AnimatedProps|AnimatedReaction|DerivedValue)\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The text between the '(' at `open` and its matching ')'. */
function balanced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** Bodies that run on the UI thread in `source`. */
function uiThreadBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const re of [GESTURE_CALLBACK, ANIMATED_HOOK]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) bodies.push(balanced(source, m.index + m[0].length - 1));
  }
  return bodies;
}

/** Names called as plain functions (not methods) in `body`. */
function calledNames(body: string): Set<string> {
  const names = new Set<string>();
  // A lookbehind, not a consumed prefix: `withTiming(helper(x))` must yield
  // helper too, and a consumed '(' would hide it.
  const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) names.add(m[1]);
  return names;
}

/** The body of a top-level function or const-arrow named `name`, or null. */
function definitionBody(source: string, name: string): string | null {
  const decl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{`);
  const arrow = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:\\([^)]*\\)|[\\w$]+)[^=]*=>\\s*\\{`);
  const m = decl.exec(source) ?? arrow.exec(source);
  if (!m) return null;
  return source.slice(m.index + m[0].length, m.index + m[0].length + 400);
}

/** Where `name` is imported from in `source`, resolved to a file in this repo. */
function localImport(file: string, source: string, name: string): string | null {
  const re = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const imported = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop());
    if (!imported.includes(name)) continue;
    const spec = m[2];
    let base: string;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(file), spec);
    else return null; // a library: its worklets are its own business
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (existsSync(base + ext)) return base + ext;
    }
  }
  return null;
}

const isWorklet = (body: string) => /^\s*['"]worklet['"]/.test(body);

test('every repo function called on the UI thread is a worklet', () => {
  const offenders: string[] = [];
  let checked = 0;

  for (const file of ROOTS.flatMap((r) => walk(r))) {
    const source = readFileSync(file, 'utf8');
    for (const body of uiThreadBodies(source)) {
      for (const name of calledNames(body)) {
        let defFile = file;
        let def = definitionBody(source, name);
        if (def === null) {
          const target = localImport(file, source, name);
          if (!target) continue;
          defFile = target;
          def = definitionBody(readFileSync(target, 'utf8'), name);
          if (def === null) continue;
        }
        checked++;
        if (!isWorklet(def)) {
          offenders.push(`${name} (defined in ${defFile.slice(SRC.length + 1)}, called on the UI thread in ${file.slice(SRC.length + 1)})`);
        }
      }
    }
  }

  expect(offenders).toEqual([]);
  // The scan must actually reach something: timed, project and rubberband are
  // all called from kit.tsx's gestures.
  expect(checked).toBeGreaterThanOrEqual(3);
});

test('the scan catches a non-worklet helper called from a gesture', () => {
  const fixture = `
function helper(x: number) {
  return x * 2;
}
const pan = Gesture.Pan().onEnd((e) => {
  y.value = withTiming(helper(e.velocityY));
});`;
  const names = [...uiThreadBodies(fixture).flatMap((b) => [...calledNames(b)])];
  expect(names).toContain('helper');
  expect(isWorklet(definitionBody(fixture, 'helper')!)).toBe(false);
});
