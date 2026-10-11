import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The identity's rules, held over every screen and component.
 *
 * identity.test.ts holds the tokens and the motion spec; palettes.test.ts the
 * palette screens read. Neither notices a screen that ignores them, and that
 * is how the old themes survived the first retheme: a hard-coded violet
 * gradient here, a 700 ms spring there, each one invisible to every test. This
 * file reads the source of src/app and src/components and fails on the things
 * DESIGN-IDENTITY.md rules out.
 *
 * Comments are stripped first, so a note about what a screen *used* to do
 * ("the old header was a violet gradient") is not a violation.
 */

const ROOT = join(import.meta.dir, '..', '..');
const SCANNED = ['app', 'components'].map((d) => join(ROOT, d));

/**
 * Files allowed one specific exception, each for a reason that is written
 * down at the site.
 */
const ALLOW: Record<string, readonly Rule['name'][]> = {
  // LEGACY_MARKS: the retired account-colour ramps, kept only to read an old
  // saved value back as the position it meant. Never rendered.
  'app/accounts.tsx': ['hex colour'],
  // The silver sheen inside the progress line: the identity's one gradient.
  'components/identity/primitives.tsx': ['gradient'],
};

interface Rule {
  name: 'spring' | 'loop' | 'overshooting easing' | 'gradient' | 'hex colour' | 'rgb colour' | 'named white or black' | 'second palette hook' | 'slow animation';
  test: (code: string) => string[];
}

const all = (re: RegExp) => (code: string) => [...code.matchAll(re)].map((m) => m[0]);

const RULES: Rule[] = [
  { name: 'spring', test: all(/\bwithSpring\s*\(/g) },
  { name: 'loop', test: all(/\bwithRepeat\s*\(/g) },
  { name: 'overshooting easing', test: all(/\bEasing\.(bounce|elastic|back)\b/g) },
  { name: 'gradient', test: all(/\bLinearGradient\b/g) },
  { name: 'hex colour', test: all(/['"`]#[0-9A-Fa-f]{3,8}['"`]/g) },
  { name: 'rgb colour', test: all(/\brgba?\s*\(/g) },
  { name: 'named white or black', test: all(/['"](white|black)['"]/g) },
  { name: 'second palette hook', test: all(/\buseB\s*\(/g) },
  {
    name: 'slow animation',
    // A literal duration over the 280 ms ceiling (the spec's slowest is 280).
    test: (code) => [...code.matchAll(/\bduration\s*:\s*(\d+)/g)].filter((m) => Number(m[1]) > 280).map((m) => m[0]),
  },
];

/** Block and line comments out; strings and code stay. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function violations(code: string, allowed: readonly string[] = []): string[] {
  return RULES.filter((r) => !allowed.includes(r.name)).flatMap((r) =>
    r.test(code).map((hit) => `${r.name}: ${hit}`)
  );
}

describe('identity conventions', () => {
  const files = SCANNED.flatMap(walk);

  it('scans the screens and components', () => {
    // A guard against a path change silently scanning nothing.
    expect(files.length).toBeGreaterThan(40);
  });

  it('catches each rule on a known violation (positive control)', () => {
    const sample = [
      "x.value = withSpring(1);",
      "withRepeat(withTiming(1), -1);",
      "Easing.bounce;",
      "<LinearGradient colors={a} />",
      "color: '#7C3AED',",
      "backgroundColor: 'rgba(255,255,255,0.1)',",
      "color: 'white',",
      "const B = useB();",
      "withTiming(1, { duration: 700 });",
    ].join('\n');
    const found = new Set(violations(sample).map((v) => v.split(':')[0]));
    expect([...found].sort()).toEqual(RULES.map((r) => r.name).sort());
    // And a comment describing the old design is not a violation.
    expect(violations(stripComments("// the old hero was a 'white' gradient, '#7C3AED'\n/* withSpring( */"))).toEqual([]);
  });

  it('keeps BalanceCard\'s style off its filled shadow layer', () => {
    // A caller's gutter passed as padding on the filled layer drew the anchor
    // twice, a full-width espresso slab behind the real card, on five screens.
    const kit = readFileSync(join(ROOT, 'components', 'kit.tsx'), 'utf8');
    const start = kit.indexOf('export function BalanceCard(');
    const body = kit.slice(start, kit.indexOf('\nexport function', start + 1));
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/\[\s*outer\s*,\s*style\s*\]/);
    expect(body).toMatch(/<View style=\{style\}>/);
  });

  it('makes every anchored screen choose its empty-state action deliberately', () => {
    // One espresso block per screen. An Empty's action is espresso by default,
    // which is right when the empty state replaces the anchor and a second
    // anchor when it sits under one. Static analysis cannot tell which, so a
    // screen with an anchor has to say: actionVariant "secondary" or "ink".
    const offenders: string[] = [];
    for (const file of files.filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(file, 'utf8');
      if (!/<BalanceCard\b|<Card\b[^>]*\banchor\b/.test(src)) continue;
      for (const m of src.matchAll(/<Empty\b/g)) {
        const lineStart = src.lastIndexOf('\n', m.index!) + 1;
        const indent = m.index! - lineStart;
        const close = new RegExp(`\\n {${indent}}/>`).exec(src.slice(m.index!));
        const props = src.slice(m.index!, close ? m.index! + close.index : m.index! + 600);
        if (props.includes('actionLabel') && !props.includes('actionVariant')) {
          offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index!).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('holds every screen and component to the identity', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const v of violations(code, ALLOW[rel])) offenders.push(`${rel} — ${v}`);
    }
    expect(offenders).toEqual([]);
  });
});
