import { useColorScheme, type TextStyle } from 'react-native';
import { C_DARK, C_LIGHT, B_DARK, B_LIGHT, type Palette, type BizPalette } from './palettes';
import { resolveScheme, useThemeStore } from './theme-store';

export { mix } from './palettes';

/**
 * Shared design language — DESIGN-PROMPT.md §3 and §4.
 *
 * One layout system, one type scale, one component set, one neutral ground.
 * The two profiles differ only in a quiet accent hue:
 *   C — personal, violet
 *   B — business, mint
 *
 * Both palettes expose the SAME keys, so a component reads `C.ink` without
 * caring which profile or scheme is active. Get the live palette from
 * useC()/useB(); the bare `C`/`B` exports are the *light* palettes, because
 * light is the app and dark is a derivation of it.
 *
 * Light first. Dark is the same layouts and the same spacing with the ground
 * swapped, and it inverts the one dark object into one light object.
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
export const C = C_LIGHT;
export const B = B_LIGHT;

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

/** The personal palette for the active scheme. */
export function useC(): Palette {
  return useScheme() === 'light' ? C_LIGHT : C_DARK;
}

/** The business palette for the active scheme. */
export function useB(): BizPalette {
  return useScheme() === 'light' ? B_LIGHT : B_DARK;
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

// ── Radii (§4) ───────────────────────────────────────────────────────────────
/**
 * chip/pill 999 · icon squircle 14 · card 22 · big card 24 · sheet 28.
 *
 * The old names are kept because ~200 sites read them; they now point at the
 * new values, so an un-migrated screen picks up the new shape for free.
 */
export const R = {
  /** Icon squircle. */
  sm: 14,
  /** Card. */
  md: 22,
  /** Big card — the balance card. */
  lg: 24,
  /** Bottom sheet. */
  xl: 28,
  pill: 999,
};

// ── Layout (§4) ──────────────────────────────────────────────────────────────
export const S = {
  /** Screen padding, horizontal. */
  screen: 20,
  /** Between sections. Deliberately larger than feels necessary. */
  section: 32,
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
  /** Icon stroke. Thin and rounded, never filled. */
  stroke: 1.75,
};

// ── Type scale (§3) ──────────────────────────────────────────────────────────
/**
 * Eight sizes, no more. There is deliberately no uppercase caption style —
 * the references have none, and adding one makes the app look like a
 * dashboard.
 *
 * The brief states tracking as a percentage; React Native's letterSpacing is
 * in points, so each is converted against its own size (-2.0% of 40 = -0.8).
 */
export const T = {
  display:  { fontSize: 40, lineHeight: 44, weight: 'bold', letterSpacing: -0.8 },
  title:    { fontSize: 32, lineHeight: 38, weight: 'bold', letterSpacing: -0.48 },
  headline: { fontSize: 28, lineHeight: 36, weight: 'bold', letterSpacing: -0.28 },
  section:  { fontSize: 20, lineHeight: 26, weight: 'bold', letterSpacing: -0.1 },
  cardTitle:{ fontSize: 17, lineHeight: 23, weight: 'semibold', letterSpacing: -0.05 },
  body:     { fontSize: 16, lineHeight: 24, weight: 'regular', letterSpacing: 0 },
  meta:     { fontSize: 13, lineHeight: 18, weight: 'medium', letterSpacing: 0 },
  tab:      { fontSize: 11, lineHeight: 14, weight: 'medium', letterSpacing: 0.11 },
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

export const SHADOW = {
  near: {
    shadowColor: '#12172B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 8,
    elevation: 2,
  },
  far: {
    shadowColor: '#12172B',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

/**
 * @deprecated The calm direction has no glows (§1, "what to leave behind").
 *
 * Kept only because ~18 sites still call it. `glowScale` is 0 in light, so
 * this already returns an invisible shadow there; new code must not call it.
 */
export function glow(color: string = C.accent, opacity = 0.45, radius = 22, scale = 1) {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: opacity * scale,
    shadowRadius: radius,
    elevation: 10,
  } as const;
}

