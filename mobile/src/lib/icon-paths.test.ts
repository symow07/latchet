import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_PATHS, ICON_PATHS_BAR, ICON_PATHS_LINE, type IconArt } from './icon-paths';

const ALL: [string, IconArt][] = [
  ...Object.entries(ICON_PATHS),
  ...Object.entries(ICON_PATHS_LINE),
  ...Object.entries(ICON_PATHS_BAR),
];

describe('the icon set', () => {
  it('gives every icon real artwork', () => {
    // The generator writes this file, so a fetch that half-succeeded, a set
    // that renamed a glyph, or a bad hand-edit all land here as an icon with no
    // path — which renders as nothing at all, silently, on whichever screen
    // happens to use it. Cheaper to fail here than to find it by opening 42
    // screens.
    const empty = ALL.filter(([, art]) => art.paths.length === 0 || art.paths.some((p) => !p.d));
    expect(empty.map(([n]) => n)).toEqual([]);
  });

  it('draws every glyph as a single-weight outline, never a fill', () => {
    // The identity's icon rule: thin outlined glyphs, rounded, never filled or
    // two-tone. A filled path or a faded second tone means a glyph from some
    // other set slipped in.
    const filled = ALL.flatMap(([n, art]) => art.paths.filter((p) => !p.stroke).map(() => n));
    expect(filled).toEqual([]);
    const toned = ALL.flatMap(([n, art]) => art.paths.filter((p) => p.opacity !== undefined).map(() => n));
    expect(toned).toEqual([]);
    // One weight: 1.5 on the 24 grid, and 2 only for the dot marks the
    // reference uses as texture (a dot is a zero-length round-capped stroke).
    const weights = new Set(ALL.flatMap(([, art]) => art.paths.map((p) => p.stroke ?? 0)));
    for (const w of weights) expect([1.5, 2]).toContain(w);
  });

  it('never draws a square end or a sharp corner', () => {
    // Paths that leave caps or joins unset are drawn round by icons.tsx; any
    // that set them must set them round.
    const sharp = ALL.flatMap(([n, art]) =>
      art.paths.filter((p) => (p.cap && p.cap !== 'round') || (p.join && p.join !== 'round')).map(() => n)
    );
    expect(sharp).toEqual([]);
    const renderer = readFileSync(join(import.meta.dir, '..', 'components', 'icons.tsx'), 'utf8');
    expect(renderer).toContain("strokeLinecap={p.cap ?? 'round'}");
    expect(renderer).toContain("strokeLinejoin={p.join ?? 'round'}");
  });

  it('comes from the reference family, Hugeicons stroke rounded', () => {
    // The one exception is a glyph the family lacks, drawn in its grammar in
    // scripts/generate-icons.mjs (DRAWN). It is named here so a second one is
    // a decision, not a drift.
    const DRAWN = ['drawn:backspace'];
    const elsewhere = ALL.filter(
      ([, art]) => !art.source.startsWith('hugeicons:') && !DRAWN.includes(art.source)
    ).map(([n]) => n);
    expect(elsewhere).toEqual([]);
  });

  it('draws its own glyphs at the family\'s single 1.5 stroke', () => {
    const drawn = ALL.filter(([, art]) => art.source.startsWith('drawn:'));
    expect(drawn.length).toBeGreaterThan(0);
    for (const [, art] of drawn) {
      for (const p of art.paths) {
        expect(p.stroke).toBe(1.5);
        expect(p.cap).toBe('round');
        expect(p.join).toBe('round');
      }
    }
  });

  it('records where each glyph came from', () => {
    // `source` is what makes a swap possible later: without it, changing one
    // icon means guessing which set and name produced the path data.
    const unsourced = ALL.filter(([, art]) => !/^[a-z0-9-]+:[a-z0-9-]+$/.test(art.source));
    expect(unsourced.map(([n]) => n)).toEqual([]);
  });

  it('gives every tab-bar destination its glyph in both state maps', () => {
    // The active tab is marked by the tint and a capsule, not by a filled
    // glyph, so both maps carry the same outline; a destination missing from
    // either would render nothing in that state.
    expect(Object.keys(ICON_PATHS_LINE).sort()).toEqual(Object.keys(ICON_PATHS_BAR).sort());
  });

  it('is the only icon source in the app', () => {
    // Every screen draws from components/icons.tsx. A direct import of an icon
    // package would put a glyph from another set next to these on the same
    // screen — the exact inconsistency this replaced, twice.
    const roots = [join(import.meta.dir, '..', 'app'), join(import.meta.dir, '..', 'components')];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : e.name.endsWith('.tsx')
            ? [join(dir, e.name)]
            : []
      );

    const offenders = roots
      .flatMap(walk)
      .filter((f) => /from\s*['"](lucide-react-native|@expo\/vector-icons)/.test(readFileSync(f, 'utf8')))
      .map((f) => f.split('/').slice(-2).join('/'));

    expect(offenders).toEqual([]);
  });
});
