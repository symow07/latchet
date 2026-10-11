/**
 * Colour palettes, as plain data.
 *
 * Kept free of any react-native import so the values can be unit-tested
 * without a simulator — design.ts adds the hooks that pick between them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONE IDENTITY (DESIGN-IDENTITY.md). The violet personal theme and the green
 * business theme are gone: both profiles are built from the same identity
 * tokens (lib/identity/tokens.ts), so `C_LIGHT` and `B_LIGHT` carry the same
 * colours and differ only in which legacy alias names they also expose. A
 * screen reading `C.accent` and one reading `B.accent` get the same espresso.
 *
 * `Tokens` keeps the canonical key set the screens already read, each key
 * re-pointed at the identity role that now does its job, plus the identity's
 * own roles (espresso, tint, silver…) for anything written from here on.
 * The legacy keys (bg, p500, slate900, …) remain as deprecated aliases.
 * ─────────────────────────────────────────────────────────────────────────
 */
import {
  BAR_TINT_ALPHA,
  DARK as I_DARK,
  LIGHT as I_LIGHT,
  type IdentityPalette,
} from './identity/tokens';

/**
 * The canonical design tokens. Both profiles expose exactly these keys, with
 * the same values.
 */
export type Tokens = {
  scheme: 'light' | 'dark';

  // ── Ground ──
  /** The page. Off-white in light, never #FFFFFF; roasted espresso-black in dark. */
  ground: string;
  /** Cards, sheets, input fields: the identity's `surface`. */
  groundAlt: string;
  /** Wells, inactive chip fill, chart tracks, glyph tiles: the identity's `sunk`. */
  groundSunk: string;

  // ── Ink ──
  /** Headlines, amounts, body text and glyphs. */
  ink: string;
  /**
   * The one dark object: the screen's anchor card. It is espresso now, in
   * both schemes (it no longer inverts to a light card in dark mode).
   */
  inkSoft: string;
  /** Text and glyphs on an `ink` fill (a pill or button filled with ink). */
  onInk: string;
  /** Text and glyphs on an `accent` fill. */
  onAccent: string;
  /** All secondary text. ≥ 4.5:1 in both schemes. */
  inkDim: string;
  /** Decorative and disabled ONLY. Never set a sentence in this. */
  inkFaint: string;
  hairline: string;

  // ── Semantic ──
  /** Income, approved, under budget. Green. */
  positive: string;
  /** Spending, rejected, over budget. Red. */
  negative: string;
  warning: string;

  // ── Accent: the identity's interactive tint ──
  /** Links, active pills, selected glyphs. Espresso in light, latte in dark. */
  accent: string;
  accentPress: string;
  /** Selected wash behind a chip or tab: the identity's `tintSoft`. */
  accentSoft: string;
  /** Single-series chart marks and meter fills. */
  accentMark: string;
  /** Decorative only: silver. */
  accentGlow: string;
  /** Kept for the type; the identity has no gradient moment. Flat silver. */
  gradient: readonly [string, string, string];
  /** The anchor's fill, as three equal stops: flat espresso, no gradient. */
  heroGradient: readonly [string, string, string];
  /** Inactive tab glyph. */
  onBar: string;
  /** The tab bar's tint over the system blur, alpha included. */
  barTint: string;
  /** The capsule behind the selected tab. */
  barSelection: string;
  /** Retired quick-action tile layers, kept for the type. Transparent. */
  tileSheen: string;
  tileRim: string;
  tileGlint: string;
  /** Glyph on the selected tab. */
  onBarActive: string;
  /** Text on the anchor. */
  onHero: string;
  /** Retired ambient blooms, kept for the type. Equal to the ground. */
  mesh: readonly [string, string];
  /**
   * Chart series and saved account marks: a warm ramp from espresso through
   * umber and bronze to platinum, never a rainbow. Every step clears 3:1 on
   * its own ground. Categories in lists are marked by glyph, not by colour.
   */
  cat: readonly string[];
  /** Zero: the identity has no glows. */
  glowScale: number;

  // ── The identity's own roles (lib/identity/tokens.ts) ──
  /** The signature: the anchor card and the primary button. */
  espresso: string;
  espressoPress: string;
  onEspresso: string;
  /** Secondary text on espresso: silver. */
  onEspressoDim: string;
  /** Interactive foreground (same as `accent`). */
  tint: string;
  tintSoft: string;
  /** Warm, neutral platinum: fills, lines, figures on espresso. */
  silver: string;
  silverHi: string;
  /** The hairline silver edge on every lifted surface. */
  silverEdge: string;
  silverSoft: string;
  silverInk: string;
  /** Shadow colour: espresso in light, black in dark. */
  shadow: string;
};

/** Kept for callers that composite with it; the blooms themselves are retired. */
export const MESH_ALPHA = [0, 0] as const;

/** Retired with the old quick-action tile; press feedback is a scale now. */
export const TILE_PRESS_ALPHA = 0;

/** §2.5 replacement — warm ramp on #F6F3EF, every step ≥ 3.55:1. */
const CAT_LIGHT = [
  '#3B2A21', // espresso 12.34
  '#6A4A38', // cocoa     7.17
  '#8A5F45', // umber     4.99
  '#9C6B3F', // caramel   4.14
  '#7D6A4F', // bronze    4.69
  '#6E6862', // stone     4.97
  '#4F4A45', // graphite  7.92
  '#84807A', // platinum  3.55
] as const;

/** Warm ramp on #14110E, every step ≥ 6.66:1. */
const CAT_DARK = [
  '#D9C4B1', // latte    11.18
  '#C9A88E', // cocoa     8.49
  '#D2A27A', // umber     8.23
  // Caramel was #C9AE84, 11.7 RGB units from cocoa: two accounts in those
  // positions read as one colour. palettes.test.ts now holds a spacing floor.
  '#E3BC7E', // caramel  10.54
  '#B9A68C', // bronze    7.97
  '#B6B3AE', // stone     9.00
  '#D6D2CC', // graphite 12.50
  '#9E9993', // platinum  6.66
] as const;

/** 6-digit hex at `alpha`, as rgba() — for the two tokens that carry alpha. */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The canonical tokens, from one identity palette. */
function tokens(I: IdentityPalette): Tokens {
  const dark = I.scheme === 'dark';
  return {
    scheme: I.scheme,
    ground: I.ground,
    groundAlt: I.surface,
    groundSunk: I.sunk,
    ink: I.ink,
    inkSoft: I.espresso,
    // An ink fill is near-black in light and near-white in dark.
    onInk: dark ? I.ground : I.onEspresso,
    // The accent is espresso in light and latte in dark, so its foreground
    // flips the same way.
    onAccent: dark ? I.ground : I.onEspresso,
    inkDim: I.inkDim,
    inkFaint: I.inkFaint,
    hairline: I.hairline,
    positive: I.positive,
    negative: I.negative,
    warning: I.warning,
    accent: I.tint,
    accentPress: dark ? '#C4AE9A' : I.espressoPress,
    accentSoft: I.tintSoft,
    accentMark: I.tint,
    accentGlow: I.silver,
    gradient: [I.silverHi, I.silver, I.silver],
    heroGradient: [I.espresso, I.espresso, I.espresso],
    onBar: I.inkDim,
    barTint: rgba(I.barTint, BAR_TINT_ALPHA[I.scheme]),
    barSelection: I.tintSoft,
    tileSheen: 'rgba(0,0,0,0)',
    tileRim: I.silverEdge,
    tileGlint: I.silverHi,
    onBarActive: I.tint,
    onHero: I.onEspresso,
    mesh: [I.ground, I.ground],
    cat: dark ? CAT_DARK : CAT_LIGHT,
    glowScale: 0,
    espresso: I.espresso,
    espressoPress: I.espressoPress,
    onEspresso: I.onEspresso,
    onEspressoDim: I.onEspressoDim,
    tint: I.tint,
    tintSoft: I.tintSoft,
    silver: I.silver,
    silverHi: I.silverHi,
    silverEdge: I.silverEdge,
    silverSoft: I.silverSoft,
    silverInk: I.silverInk,
    shadow: I.shadow,
  };
}

/**
 * Legacy personal keys. Deprecated — every one is an alias onto a token
 * above. Kept so screens written against the old names still compile and
 * land on the identity.
 */
type LegacyPersonal = {
  bg: string; bgDeep: string; bgRaise: string; bgFoot: string;
  p950: string; p900: string; p800: string; p700: string; p600: string;
  p500: string; p400: string; p300: string; p200: string; lilac: string;
  rose: string; amber: string; green: string; sky: string;
  text: string; textDim: string; textFaint: string;
  glass: string; glassStrong: string; glassBorder: string;
};

/** Legacy business keys. Deprecated, same reasoning as LegacyPersonal. */
type LegacyBusiness = {
  bg: string; bgDeep: string; bgRaise: string;
  slate900: string; slate800: string; slate700: string;
  heroFrom: string; heroTo: string;
  accentDeep: string;
  teal: string; amber: string; red: string; green: string;
  text: string; textDim: string; textFaint: string;
  glass: string; glassStrong: string; glassBorder: string;
};

/**
 * The canonical token names, as data. Both profiles must expose exactly these
 * keys; the tests check it.
 */
export const TOKEN_KEYS = [
  'scheme',
  'ground', 'groundAlt', 'groundSunk',
  'ink', 'inkSoft', 'onInk', 'onAccent', 'inkDim', 'inkFaint', 'hairline',
  'positive', 'negative', 'warning',
  'accent', 'accentPress', 'accentSoft', 'accentMark', 'accentGlow',
  'gradient', 'heroGradient', 'mesh', 'onHero', 'cat', 'glowScale',
  'onBar', 'barTint', 'barSelection', 'onBarActive',
  'tileSheen', 'tileRim', 'tileGlint',
  'espresso', 'espressoPress', 'onEspresso', 'onEspressoDim',
  'tint', 'tintSoft', 'silver', 'silverHi', 'silverEdge', 'silverSoft', 'silverInk', 'shadow',
] as const satisfies readonly (keyof Tokens)[];

/**
 * One palette type for both profiles: the tokens plus *both* profiles' legacy
 * alias names, so a screen written against either reads the same object.
 */
export type Palette = Tokens & LegacyPersonal & LegacyBusiness;
/** @deprecated Same as Palette since the identity unified the profiles. */
export type BizPalette = Palette;

/**
 * The deprecated aliases shared by both profiles. `textFaint` points at
 * `inkDim`, not `inkFaint`: the legacy key sets body text, and inkFaint may
 * never carry a sentence.
 */
function legacyShared(t: Tokens) {
  return {
    bg: t.ground,
    bgDeep: t.ground,
    bgRaise: t.groundAlt,
    text: t.ink,
    textDim: t.inkDim,
    textFaint: t.inkDim,
    glass: t.groundAlt,
    // Highlights painted on the espresso anchor: silver, never white.
    glassStrong: rgba(t.silver, 0.18),
    glassBorder: t.hairline,
  };
}

function palette(I: IdentityPalette): Palette {
  const t = tokens(I);
  return {
    ...t,
    ...legacyShared(t),
    // Personal aliases.
    bgFoot: t.ground,
    p950: t.espressoPress, p900: t.espressoPress, p800: t.espressoPress,
    p700: t.espressoPress, p600: t.espressoPress,
    p500: t.accent,
    p400: t.accentMark, p300: t.accentMark,
    p200: t.accentSoft, lilac: t.silver,
    rose: t.negative, amber: t.warning, green: t.positive,
    sky: t.silverInk,
    // Business aliases.
    slate900: t.groundAlt, slate800: t.groundSunk, slate700: t.inkFaint,
    heroFrom: t.espresso, heroTo: t.espresso,
    accentDeep: t.accentPress,
    teal: t.positive, red: t.negative,
  };
}

/** The one palette, per scheme. */
export const P_LIGHT: Palette = palette(I_LIGHT);
export const P_DARK: Palette = palette(I_DARK);

/** Personal and business are the same object: one identity. */
export const C_LIGHT = P_LIGHT;
export const C_DARK = P_DARK;
/** @deprecated Same object as C_LIGHT. */
export const B_LIGHT = P_LIGHT;
/** @deprecated Same object as C_DARK. */
export const B_DARK = P_DARK;

/**
 * Composite `overlay` at `alpha` over opaque `base`, returning an opaque hex.
 * Both arguments must be 6-digit hex; alpha is 0..1.
 */
export function mix(base: string, overlay: string, alpha: number): string {
  const parse = (h: string) => {
    const v = h.replace('#', '');
    return [
      parseInt(v.slice(0, 2), 16),
      parseInt(v.slice(2, 4), 16),
      parseInt(v.slice(4, 6), 16),
    ];
  };
  const [br, bg, bb] = parse(base);
  const [or, og, ob] = parse(overlay);
  const a = Math.min(1, Math.max(0, alpha));
  const ch = (o: number, b: number) =>
    Math.round(o * a + b * (1 - a)).toString(16).padStart(2, '0');
  return `#${ch(or, br)}${ch(og, bg)}${ch(ob, bb)}`;
}
