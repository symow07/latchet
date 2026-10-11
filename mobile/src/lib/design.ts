import { useColorScheme, type TextStyle } from 'react-native';
import { P_DARK, P_LIGHT, type Palette, type BizPalette } from './palettes';
import { ELEVATION, RADIUS, SPACE, TYPE } from './identity/tokens';
import { resolveScheme, useThemeStore } from './theme-store';

export { mix } from './palettes';

/**
 * Shared design language — DESIGN-IDENTITY.md.
 *
 * One identity for both profiles: an off-white ground, one espresso anchor
 * per screen, ink for text, a warm platinum silver for the details. Personal
 * and business used to differ by accent (violet, mint); they now read the
 * same palette object, so nothing a screen does can drift between them.
 *
 * Get the live palette from useC(). The bare `C` export is the light palette,
 * for the few module-scope constants that cannot call a hook. Light is the
 * app; dark is the same layouts with the ground swapped.
 *
 * Radii, spacing, type and shadow here are the identity's tokens under the
 * names the screens already use.
 */

export type { Palette, BizPalette };

/**
 * Light palettes. Prefer useC()/useB() — these exist for the handful of
 * module-scope constants that cannot call a hook.
 *
 * These used to be the dark palettes. Light is now the app (§2), so a
 * constant that never re-reads the scheme should default to light rather
 * than to the derivation.
 */
export const C = P_LIGHT;
/** @deprecated The same palette as `C`. */
export const B = P_LIGHT;

/**
 * The scheme actually being rendered.
 *
 * The user's own preference wins over the OS; "system" defers to it. Every
 * palette hook goes through here, so a change in Settings reaches the whole
 * app without any screen knowing the setting exists.
 */
export function useScheme(): 'light' | 'dark' {
  const preference = useThemeStore((s) => s.preference);
  return resolveScheme(preference, useColorScheme());
}

/** The palette for the active scheme: the one identity, both profiles. */
export function useC(): Palette {
  return useScheme() === 'light' ? P_LIGHT : P_DARK;
}

/** @deprecated Identical to useC(); kept so unconverted callers compile. */
export function useB(): BizPalette {
  return useC();
}

// ── Typography (§3) ──────────────────────────────────────────────────────────
/**
 * The four weights, on the platform's own face.
 *
 * These were Plus Jakarta Sans, per §3. It is a good geometric-humanist sans,
 * and it is also the reason the app did not read as native: its rounded
 * terminals and wide bowls say *friendly startup*, and no amount of colour or
 * shadow work argues with a typeface.
 *
 * No `fontFamily` at all, rather than the string `'System'` — omitting it is
 * what gets SF on iOS and Roboto on Android, and it is SF that brings the
 * things a webfont cannot: optical sizing that switches between Text and
 * Display cuts by point size, per-size tracking tables, and Dynamic Type
 * metrics. That is most of what "looks like an Apple app" is made of, and it
 * arrives for free the moment you stop overriding it.
 *
 * Spread these rather than assigning one property — `...F.bold`, not
 * `...F.bold` — because a weight is now two properties, not one.
 */
export const F = {
  regular: { fontWeight: '400' },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
} as const satisfies Record<string, TextStyle>;

// ── Radii ────────────────────────────────────────────────────────────────────
/**
 * The identity's radii under the names ~200 sites already read. Every corner
 * should also set `borderCurve: 'continuous'` (a squircle, not a quarter
 * circle); kit components do.
 */
export const R = {
  /** Glyph tile. */
  sm: RADIUS.tile,
  /** Card. */
  md: RADIUS.card,
  /** The anchor (the balance card). */
  lg: RADIUS.anchor,
  /** Bottom sheet. */
  xl: RADIUS.sheet,
  /** Buttons, inputs, quick-action cards. */
  control: RADIUS.control,
  pill: RADIUS.pill,
};

// ── Layout (§4) ──────────────────────────────────────────────────────────────
export const S = {
  /** Screen padding, horizontal: the identity's 24 gutter. */
  screen: SPACE.gutter,
  /** Between sections: three times the gap inside one. */
  section: SPACE.section,
  /**
   * Between things that belong to each other inside one section.
   *
   * The second level of rhythm. With a single gap value every block on a screen
   * sits the same distance from every other, so a balance, a budget line and a
   * list of transactions read as three unrelated items rather than as two
   * groups — the eye gets no help at all. Proximity is the cheapest hierarchy
   * there is: near means related, far means not, and you need both numbers for
   * either to mean anything.
   *
   * 16 rather than 18 so the whole scale sits on the 8pt grid §4 asks for:
   *
   *     8  tight    inside a block — a label and the thing it labels
   *     16 group    between related blocks
   *     24          between blocks that are related but not tightly
   *     32 section  between subjects
   *
   * Screens used to pick from 10, 12, 14, 16, 18, 20, 22, 24 and 28 by hand,
   * which is why the rhythm read as arbitrary: gaps doing the same job came out
   * three different sizes on the same screen.
   */
  group: 16,
  /** Between related blocks that still want more air than `group`. */
  wide: 24,
  /** Inside a block — a label and the thing it labels. */
  tight: 8,
  /** Inside a card. */
  card: 20,
  /** Icon stroke. Ignored by icons.tsx (the set draws at its own 1.5). */
  stroke: 1.5,
};

// ── Type scale (§3) ──────────────────────────────────────────────────────────
/**
 * Eight sizes, no more, on San Francisco. The identity's scale (TYPE in
 * identity/tokens.ts) under the role names the screens use: semibold rather
 * than bold, body at the HIG's 17, tracking only at display sizes.
 */
export const T = {
  display:  { fontSize: TYPE.display.size, lineHeight: TYPE.display.line, weight: 'semibold', letterSpacing: TYPE.display.tracking },
  title:    { fontSize: TYPE.largeTitle.size, lineHeight: TYPE.largeTitle.line, weight: 'semibold', letterSpacing: TYPE.largeTitle.tracking },
  headline: { fontSize: 28, lineHeight: 34, weight: 'semibold', letterSpacing: -0.4 },
  section:  { fontSize: TYPE.title.size, lineHeight: TYPE.title.line, weight: 'semibold', letterSpacing: TYPE.title.tracking },
  cardTitle:{ fontSize: TYPE.headline.size, lineHeight: TYPE.headline.line, weight: 'semibold', letterSpacing: 0 },
  body:     { fontSize: TYPE.body.size, lineHeight: TYPE.body.line, weight: 'regular', letterSpacing: 0 },
  meta:     { fontSize: TYPE.footnote.size, lineHeight: TYPE.footnote.line, weight: 'medium', letterSpacing: 0 },
  tab:      { fontSize: 11, lineHeight: 14, weight: 'medium', letterSpacing: 0.1 },
} as const;

// ── Shadow (§1.5, §7) ────────────────────────────────────────────────────────
/**
 * The only two shadows in the app. §7: do not invent per-component shadows.
 *
 * The brief specifies them as CSS (`y+2 blur 12` and `y+8 blur 28`). iOS
 * shadowRadius is a blur sigma rather than a CSS blur length, so each radius
 * is half the stated blur, which is the usual correspondence.
 *
 * Both are carrying roughly twice the opacity and a longer throw than the
 * brief asked for. The brief's values were measured against a flat bone field;
 * the ground now has an ambient wash over it, and a 4–5% shadow on a tinted
 * ground is a shadow nobody can see — every card floated with no edge and the
 * whole screen read as one soft wash. Depth is most of what "definition"
 * means on a light theme, and it is the only separation these cards get,
 * because §1.5 spends the border budget elsewhere.
 *
 * React Native paints one shadow per view, so a surface wanting both nests
 * two — which is what <Card> does. Most things need only `near`.
 */
export { BAR, capsuleInset, tabAt, tabCentre, travelInset } from './tab-bar';

/**
 * The identity's two shadow layers (ELEVATION.rest), warm espresso. A lifted
 * surface nests both: `far` (ambient) outside, `near` (contact) inside. Kit
 * components use `lift()` from components/identity/primitives.tsx, which also
 * handles dark mode and the silver edge; these are for the few screens that
 * place a shadow by hand.
 */
export const SHADOW = {
  near: {
    shadowColor: '#3B2A21',
    shadowOffset: { width: 0, height: ELEVATION.rest[0].y },
    shadowOpacity: ELEVATION.rest[0].opacity,
    shadowRadius: ELEVATION.rest[0].blur / 2,
    elevation: 2,
  },
  far: {
    shadowColor: '#3B2A21',
    shadowOffset: { width: 0, height: ELEVATION.rest[1].y },
    shadowOpacity: ELEVATION.rest[1].opacity,
    shadowRadius: ELEVATION.rest[1].blur / 2,
    elevation: 8,
  },
} as const;


