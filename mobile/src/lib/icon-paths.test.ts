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

  it('never lets a duotone\'s second tone fade below what reads at icon size', () => {
    // The second tone is not decoration — strip it from `user` and you have an
    // unlabelled circle — so it owes the 3:1 a meaningful shape owes. Solar
    // ships it at 0.5, which is tuned for the size an icon set is *shown* at
    // rather than the 20–26px it is used at here; measured against the tab
    // bar's capsule and the tinted tiles, 0.5 lands at 2.2–2.5:1. The generator
    // clamps to 0.7, the tightest floor that clears 3:1 in every case.
    const faint = ALL.flatMap(([n, art]) =>
      art.paths.filter((p) => p.opacity !== undefined && p.opacity < 0.7).map(() => n)
    );
    expect(faint).toEqual([]);
  });

  it('keeps the duotone actually two-toned', () => {
    // The counterpart to the floor: if the clamp were ever raised to 1 the
    // icons would silently become flat silhouettes, which is what they were
    // when the generator dropped `opacity` altogether and duotone was written
    // off as looking no different.
    const twoToned = ALL.filter(([, art]) => art.paths.some((p) => p.opacity !== undefined));
    expect(twoToned.length).toBeGreaterThan(0);
    for (const [, art] of twoToned) {
      for (const p of art.paths) {
        if (p.opacity !== undefined) expect(p.opacity).toBeLessThan(1);
      }
    }
  });

  it('records where each glyph came from', () => {
    // `source` is what makes a swap possible later: without it, changing one
    // icon means guessing which set and name produced the path data.
    const unsourced = ALL.filter(([, art]) => !/^[a-z0-9-]+:[a-z0-9-]+$/.test(art.source));
    expect(unsourced.map(([n]) => n)).toEqual([]);
  });

  it('gives every tab-bar icon both a solid and an outline form', () => {
    // A bar marks the active destination by filling its glyph. An icon with
    // only one form would show the same shape in both states, which reads as
    // the bar being broken rather than as a style choice.
    const solid = new Set([...Object.keys(ICON_PATHS), ...Object.keys(ICON_PATHS_BAR)]);
    const orphans = Object.keys(ICON_PATHS_LINE).filter((n) => !solid.has(n));
    expect(orphans).toEqual([]);
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
