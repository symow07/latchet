/**
 * The Latchet identity — design tokens.
 *
 * One identity for both profiles: a calm off-white ground, deep espresso as the
 * signature, silver (a warm, neutral platinum) as the accent, near-black ink
 * for text. It replaces the
 * violet (personal) and green (business) palettes in palettes.ts once Step 2b
 * lands; until then nothing outside the identity preview reads this file.
 *
 * The ground, ink and label tones are sampled from the approved icon reference
 * (#F6F3EF, #24201C, #645D56). Everything else is derived around them and held
 * to WCAG contrast by identity.test.ts.
 *
 * Pure data with no React Native imports, so `bun test` can check it.
 * Every colour is 6-digit hex: kit.tsx and mix() append alpha to token strings,
 * so an 8-digit or rgba() value here would break them silently in 2b.
 */

export type Scheme = 'light' | 'dark';

export interface IdentityPalette {
  scheme: Scheme;
  /** The page. Off-white in light, never #FFFFFF. */
  ground: string;
  /** Cards and grouped lists, one step lifted from the ground. */
  surface: string;
  /** Wells: glyph tiles, quiet fills, the held state of a row. */
  sunk: string;
  /** Primary text and glyphs. */
  ink: string;
  /** Secondary emphasis: a row's amount, a subtitle. */
  inkSoft: string;
  /** Labels, captions, meta. The lowest tone allowed to carry text. */
  inkDim: string;
  /** Disabled glyphs and decoration. Never text. */
  inkFaint: string;
  /** Dividers and outlines. */
  hairline: string;
  /** The signature surface: the screen's one anchor and the primary button. */
  espresso: string;
  /** Espresso while held. */
  espressoPress: string;
  /** Text and glyphs on espresso. */
  onEspresso: string;
  /** Secondary text on espresso. This is where silver earns text duty. */
  onEspressoDim: string;
  /** Interactive foreground in the signature hue: active tab, links, selected glyph. */
  tint: string;
  /** The wash behind a selected chip or tab. */
  tintSoft: string;
  /**
   * The accent: a warm, neutral platinum. Red sits at or above blue in every
   * silver role, so silver never reads blue against espresso and the off-white.
   * Fills, lines and figures on espresso; never text on the ground.
   */
  silver: string;
  /** Silver tracks and quiet fills. */
  silverSoft: string;
  /** Silver strong enough to carry a graphic on the ground (3:1). */
  silverInk: string;
  /** The hairline silver edge every lifted surface wears. */
  silverEdge: string;
  /** The bright end of silver's metallic sheen, at the top of the progress fill. */
  silverHi: string;
  /** Money in. Green, by convention the user asked to keep. */
  positive: string;
  /** Money out, over budget. Red, by the same convention. */
  negative: string;
  warning: string;
  /** The tab bar's tint, laid over a system blur at BAR_TINT_ALPHA. */
  barTint: string;
  /** Shadow colour: espresso rather than black, so depth stays warm. */
  shadow: string;
}

export const LIGHT: IdentityPalette = {
  scheme: 'light',
  ground: '#F6F3EF',
  surface: '#FBF9F6',
  sunk: '#EEE9E3',
  ink: '#24201C',
  inkSoft: '#3E3832',
  inkDim: '#645D56',
  inkFaint: '#8C847C',
  hairline: '#E4DED7',
  espresso: '#3B2A21',
  espressoPress: '#2C1F18',
  onEspresso: '#F6F3EF',
  onEspressoDim: '#CCC9C4',
  tint: '#3B2A21',
  tintSoft: '#E9E0D7',
  silver: '#C5C3BF',
  silverSoft: '#E6E4E1',
  silverInk: '#84807A',
  silverEdge: '#D2CFCA',
  silverHi: '#F1F0ED',
  positive: '#2B7A4B',
  negative: '#B3382B',
  warning: '#93641C',
  barTint: '#F6F3EF',
  shadow: '#3B2A21',
};

/**
 * Dark is a derivation, not a second identity: the ground becomes roasted
 * espresso-black, and the anchor stays espresso, lifted so it still separates
 * from the page. Espresso cannot carry text on a ground this dark, so `tint`
 * turns to a pale latte; the hue is the same family, inverted in value.
 */
export const DARK: IdentityPalette = {
  scheme: 'dark',
  ground: '#14110E',
  surface: '#1D1915',
  // Lifted, not darker: on a dark surface a well darker than the card reads as
  // a hole. iOS's dark fills sit above the surface for the same reason.
  sunk: '#2A241F',
  ink: '#F1ECE6',
  inkSoft: '#D9D2CA',
  inkDim: '#ADA49B',
  inkFaint: '#7A726A',
  hairline: '#2B2621',
  // Deeper and warmer than a plain lightening of the light espresso: on a
  // roasted ground a low-chroma brown reads taupe. Same hue (about 20°), more
  // chroma, still lifted 1.5:1 off the page.
  espresso: '#4A2F21',
  espressoPress: '#3E271B',
  onEspresso: '#F6F3EF',
  onEspressoDim: '#CFCCC7',
  tint: '#D9C4B1',
  tintSoft: '#2E241D',
  silver: '#B6B3AE',
  silverSoft: '#2F2D2A',
  silverInk: '#CFCCC7',
  silverEdge: '#4E4B47',
  silverHi: '#E4E2DE',
  positive: '#7CC495',
  negative: '#F08A7A',
  warning: '#D9AE63',
  barTint: '#14110E',
  shadow: '#000000',
};

export const PALETTES: Record<Scheme, IdentityPalette> = { light: LIGHT, dark: DARK };

/** How much of barTint sits over the blur. Measured against both extremes in the test. */
export const BAR_TINT_ALPHA: Record<Scheme, number> = { light: 0.76, dark: 0.75 };

/** The system material under the tab bar's tint (expo-blur `tint`). */
export const BAR_BLUR = {
  light: 'systemUltraThinMaterialLight',
  dark: 'systemUltraThinMaterialDark',
} as const satisfies Record<Scheme, string>;

// ── Type ────────────────────────────────────────────────────────────────────
//
// San Francisco throughout, by family omission (see design.ts on why the app
// sets no fontFamily). Softness comes from shape, spacing and motion rather
// than a rounded face: SF Pro Rounded is unreachable on this app's old
// architecture, and a bundled webfont reads as a website on a phone.
//
// Sizes follow the iOS text styles at the default Dynamic Type size; the 11pt
// floor and 17pt body are HIG. Tracking is left to SF's built-in tables except
// at display sizes, where a little negative tracking keeps big numerals tight.

export type TypeRole =
  | 'display'
  | 'largeTitle'
  | 'title'
  | 'headline'
  | 'body'
  | 'callout'
  | 'footnote'
  | 'caption';

export interface TypeSpec {
  size: number;
  line: number;
  weight: '400' | '500' | '600' | '700';
  tracking: number;
  /** Tabular figures, so a counting number does not shift sideways. */
  tabular?: boolean;
}

export const TYPE: Record<TypeRole, TypeSpec> = {
  display: { size: 44, line: 50, weight: '600', tracking: -1.1, tabular: true },
  largeTitle: { size: 34, line: 40, weight: '600', tracking: -0.6 },
  title: { size: 22, line: 28, weight: '600', tracking: -0.3 },
  headline: { size: 17, line: 22, weight: '600', tracking: 0 },
  body: { size: 17, line: 24, weight: '400', tracking: 0 },
  callout: { size: 15, line: 20, weight: '500', tracking: 0 },
  footnote: { size: 13, line: 18, weight: '500', tracking: 0 },
  caption: { size: 12, line: 16, weight: '500', tracking: 0.1 },
};

/** Dynamic Type is honoured up to this multiple; past it the layout clips. */
export const MAX_FONT_SCALE = 1.5;

// ── Space ───────────────────────────────────────────────────────────────────
//
// A 4-point scale. Tight inside a group, generous between groups: a section is
// 36, three times the gap between the things inside it.

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  /** Between unrelated blocks. */
  section: 36,
  /** The screen's side margin. */
  gutter: 24,
} as const;

/** Apple's minimum tappable size, in points. */
export const MIN_TARGET = 44;

// ── Shape ───────────────────────────────────────────────────────────────────
//
// Everything is rounded, and every rounded corner uses iOS's continuous curve
// (`borderCurve: 'continuous'`): a squircle, not a quarter circle on a
// rectangle. It is the same corner the reference icons draw.

export const RADIUS = {
  /** Glyph tiles and small controls. */
  tile: 14,
  /** Inputs, list rows when they stand alone, buttons. */
  control: 18,
  /** Cards and grouped lists. */
  card: 24,
  /** The anchor. */
  anchor: 30,
  /** Sheets. */
  sheet: 34,
  /** Chips, the tab bar, anything that is a capsule. */
  pill: 999,
} as const;

// ── Depth ───────────────────────────────────────────────────────────────────
//
// Layered, soft, warm. Every lifted surface casts two shadows, the way a real
// object on a table does: a tight contact shadow where it meets the page, and a
// wide ambient one that says how high it floats. One shadow alone reads as a
// sticker; the pair reads as elevation. Every layer has a y-offset and a blur;
// none is a zero-offset halo.
//
// iOS gives a view one shadow, so each layer is its own nested view (see
// `lift` in primitives.tsx). The shadow colour is espresso in light, so depth
// stays warm, and black in dark, where the opacities rise to stay visible and a
// silver edge does the rest.

export interface Shadow {
  y: number;
  blur: number;
  opacity: number;
}

/** [contact, ambient]. */
export type Elevation = readonly [Shadow, Shadow];

export const ELEVATION = {
  /** Cards and tiles at rest. */
  rest: [
    { y: 1, blur: 3, opacity: 0.08 },
    { y: 10, blur: 28, opacity: 0.1 },
  ],
  /** Floating chrome: the tab bar. */
  raised: [
    { y: 2, blur: 8, opacity: 0.08 },
    { y: 16, blur: 40, opacity: 0.14 },
  ],
  /** The anchor: the highest thing on the screen. */
  anchor: [
    { y: 3, blur: 8, opacity: 0.2 },
    { y: 24, blur: 48, opacity: 0.3 },
  ],
} as const satisfies Record<string, Elevation>;

/** Dark grounds swallow shadows; these multiply each layer's opacity there. */
export const DARK_SHADOW_GAIN = 2.6;

// ── Glyphs ──────────────────────────────────────────────────────────────────
//
// Thin, single-weight outlines on a 24-unit grid, after the approved reference:
// soft squircle containers, rounded caps and joins, one interior detail at
// most. Drawn in ink or espresso; never filled, never duotone. The only filled
// marks are dots, which the reference uses as a texture (the calendar's grid).

export const GLYPH = {
  grid: 24,
  /**
   * Stroke on the 24 grid at 24pt. Measured off the reference: its strokes are
   * 0.069 of the shape's width, and 1.2 on this grid's shapes gives 0.072.
   * 1.5 rendered a quarter heavier than the reference.
   */
  stroke: 1.2,
  /** The thinnest a stroke may render, in points, whatever the glyph's size. */
  minStrokePt: 1,
  /** Dot radius on the 24 grid. */
  dot: 1.1,
  sizes: { inline: 18, row: 22, action: 24, nav: 26 },
} as const;

/**
 * The stroke to draw in viewBox units so a glyph keeps its weight at any size.
 *
 * Scaling the 24pt stroke linearly would leave a 14pt glyph at 0.7pt, which
 * reads as hairline next to its neighbours, so small glyphs are held at the
 * floor instead.
 */
export function glyphStroke(sizePt: number): number {
  const pt = Math.max(GLYPH.minStrokePt, (GLYPH.stroke * sizePt) / GLYPH.grid);
  return (pt * GLYPH.grid) / sizePt;
}

// ── Contrast ────────────────────────────────────────────────────────────────

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a 6-digit hex colour. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two 6-digit hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` composited over `bg`, both 6-digit hex. */
export function over(fg: string, alpha: number, bg: string): string {
  const f = fg.replace('#', '');
  const g = bg.replace('#', '');
  const mixed = [0, 2, 4].map((i) => {
    const v = parseInt(f.slice(i, i + 2), 16) * alpha + parseInt(g.slice(i, i + 2), 16) * (1 - alpha);
    return Math.round(v).toString(16).padStart(2, '0');
  });
  return `#${mixed.join('').toUpperCase()}`;
}
