/**
 * Colour palettes, as plain data.
 *
 * Kept free of any react-native import so the values can be unit-tested
 * without a simulator — design.ts adds the hooks that pick between them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This file implements DESIGN-PROMPT.md §2. Two things live here at once:
 *
 *   1. `Tokens` — the canonical set. Identical keys in both profiles, so a
 *      component reads `accent` without knowing which one is active, and the
 *      two palettes are the same object shape with different values. New and
 *      redesigned screens use only these.
 *
 *   2. The legacy keys (bg, p500, glass, slate900, …). ~1,700 references
 *      across 38 screens still read them. Rather than rename at 1,700 sites,
 *      each legacy key is re-pointed at the token that now carries its job,
 *      so every un-migrated screen lands on the bone ground with ink text
 *      instead of breaking. They are deprecated: do not add new uses.
 *
 * Every ratio in the comments is measured against that palette's own ground,
 * per §7 ("if you introduce a colour, verify it").
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * The canonical design tokens. Both profiles expose exactly these keys.
 */
export type Tokens = {
  scheme: 'light' | 'dark';

  // ── Ground: the substrate, shared by both profiles ──
  /** The canvas. Warm bone in light, near-black in dark. */
  ground: string;
  /** Cards, sheets, input fields. Floats on `ground` by shadow, not border. */
  groundAlt: string;
  /** Input wells, inactive chip fill, chart tracks. Recessed below `ground`. */
  groundSunk: string;

  // ── Ink ──
  /** Headlines, amounts, active pills, primary buttons. */
  ink: string;
  /**
   * The "one dark object" card fill — §1.1. Inverts in dark mode: the one
   * dark object becomes one *light* object, a bone card on near-black.
   */
  inkSoft: string;
  /** Whatever sits on `inkSoft`. Follows the inversion. */
  onInk: string;
  /**
   * Whatever sits on an `accent` fill — a filled button, a chat bubble, a
   * selected chip.
   *
   * This is NOT always white. In dark mode the accents are light colours,
   * chosen to read against a near-black ground, so white on them measures
   * 2.72:1 (violet) and 1.74:1 (mint) — the mint case is very nearly
   * invisible. Anything filled with `accent` must take its foreground from
   * here rather than hard-coding #fff.
   */
  onAccent: string;
  /** All secondary body text. Verified ≥ 4.5:1 in both schemes. */
  inkDim: string;
  /**
   * Decorative and disabled ONLY — 2.93:1 in light. Never set a sentence in
   * this. §2.1 is explicit that the brief is wrong if anyone does.
   */
  inkFaint: string;
  hairline: string;

  // ── Semantic ──
  /** Income, approved, under budget. */
  positive: string;
  /** Spend, rejected, over budget. */
  negative: string;
  warning: string;

  // ── Accent: the only thing that differs between the two profiles ──
  /** Active pill, links, primary CTA fill. */
  accent: string;
  accentPress: string;
  /** Icon chip fills, selected row wash. A pale tint, not a text colour. */
  accentSoft: string;
  /** Single-series chart marks and meter fills. Readable; `accentGlow` is not. */
  accentMark: string;
  /**
   * DECORATIVE ONLY — §2.3.1. 1.60:1 (mint) and 2.50:1 (violet) on the bone
   * ground: invisible there. It may never carry text, an icon, a chart mark,
   * a meter fill, a border, or any element whose shape has to be read. Its one
   * job is the gradient moment, and that lives on the dark `inkSoft` card,
   * where mint reads at 9.22:1 and violet at 5.91:1.
   */
  accentGlow: string;
  /** The single gradient moment. Dark card only, never on the bone ground. */
  gradient: readonly [string, string, string];

  /**
   * The hero surface — the rich object the eye lands on.
   *
   * Runs deep→vivid along the card's diagonal, and the order is load-bearing:
   * the label, the amount and the caption all sit in the top-left, so stop 0
   * has to be dark enough to carry white text. Every stop here clears 4.5:1
   * against white; the vivid end is placed where nothing is written.
   *
   * This replaces the flat `inkSoft` fill. A single saturated colour reads as
   * a block; a gradient reads as a surface with light falling across it, and
   * that difference is most of what separates "rich" from "cheap".
   */
  heroGradient: readonly [string, string, string];
  /** Active tab: icon and label. */
  onBar: string;
  /**
   * The bar's fill, over a blur of the page behind it.
   *
   * Carries its own alpha: the bar is a material, not a colour, and the alpha is
   * the part that keeps its contrast guaranteeable rather than dependent on
   * whatever happens to be underneath.
   */
  barTint: string;
  /**
   * The capsule behind the selected tab.
   *
   * Neutral and translucent — a clear chip on the glass rather than a coloured
   * one. It was `accentSoft`, which worked but read as paint rather than
   * material.
   *
   * The rule it follows is that the capsule always pushes *away* from the glyph
   * on it: lighter in light, where the glyph is dark; darker in dark, where the
   * glyph is light. Getting that backwards is not a stylistic slip — a white
   * capsule in dark mode lightens ground that is already light wherever pale
   * content scrolls under the glass, and the accent glyph drops to 1.6:1.
   *
   * The alpha is what makes it measurable, exactly as with `barTint`. Both
   * layers composite over the same unverifiable backdrop, so `onBarActive` is
   * checked against selection-over-tint-over-extremes.
   */
  barSelection: string;
  /**
   * The highlight laid over an `accentSoft` tile — white, top to transparent.
   *
   * Carries its own alpha because the tile underneath is a *profile* colour and
   * this is not: one value has to sit correctly on lavender and on mint. Light
   * falls from above in both schemes, so it is white in both; only the amount
   * differs, and the dark figure is not a matter of taste. A white wash over a
   * dark wash lightens ground that a *light* glyph is sitting on, so the
   * contrast falls as the sheen rises — dark violet is 5.94:1 on its bare tile
   * and 4.41:1 under a 0.10 sheen. 0.08 is the most this can be and still leave
   * every profile above 4.5:1; light has no such ceiling, which is why the two
   * numbers are nowhere near each other.
   */
  tileSheen: string;
  /**
   * The tile's edge — a full ring, not a top edge.
   *
   * §12's "bright top edge = light catching the material" is drawn per-side on
   * the hero because the hero is a rectangle. On a circle a lit ring is the
   * same idea: it is what turns a flat disc of tint into something with a
   * surface. It sits over the sheen, so it is measured the same way.
   */
  tileRim: string;
  /**
   * The glint that travels round that edge.
   *
   * Brighter than `tileRim`, and it can be, because it is the only part of the
   * tile with no contrast budget to spend: the glyph sits at the centre and
   * this never reaches it.
   *
   * That is the whole reason the tile's idle motion lives on the rim. Animating
   * the *field* was the obvious idea and it does not work here — `tileSheen` is
   * measured at full strength, so the field can only ever move between that and
   * darker, and on a pale tint the entire budget is about five values of red.
   * Built that way it measured 0.4/255 between the ends of its cycle: real in
   * the pixels, invisible to a person, which is the failure BREATH_MS already
   * records once. The rim has no such ceiling.
   */
  tileGlint: string;
  /**
   * The glyph on the selected tab, sitting on a capsule of `accentSoft`.
   *
   * The bar itself is neutral and shared by both profiles; this is the one
   * place a profile's colour appears on it. Usually `accent` — mint on light is
   * the exception, where `accent` measures 4.31:1 on its own soft wash and
   * `accentPress` is used instead.
   */
  onBarActive: string;

  /**
   * Whatever sits on `heroGradient`.
   *
   * White in both schemes, and unlike `onInk` it does *not* invert. The hero
   * used to be a flat `inkSoft` fill, which had to become a bone card in dark
   * mode because a near-black card on a near-black ground has no edge. A
   * saturated gradient separates from either ground on its own, so the
   * inversion is no longer needed and the foreground can be one value. The
   * palette test pins this against every stop of the ramp.
   */
  onHero: string;

  /**
   * The ambient wash on the ground — two soft blooms, very low opacity.
   *
   * Not decoration for its own sake: a perfectly flat bone field is what makes
   * a light theme feel like paper stock rather than a room. These give the
   * ground somewhere for light to come from. They must stay faint enough that
   * `inkDim` body text over them still measures its 4.5:1, which is why they
   * are applied at a fraction of a percent of their own strength.
   */
  mesh: readonly [string, string];

  /**
   * Categorical marks for transactions. Muted on purpose — these are not
   * brand colours and must never out-shout `accent`. Every step clears 3:1
   * against its own ground; the light ramp cannot be reused on dark.
   */
  cat: readonly string[];

  /** Multiplier for glow(). Zero in light: §1 leaves the glows behind. */
  glowScale: number;
};

/**
 * How strongly each bloom of the ambient ground is painted, 0..1.
 *
 * Exported rather than buried in the component so the palette test can
 * composite them over the ground and check the result still carries body
 * text. §7 requires anything introduced to be measured, and a number written
 * inline in a style prop is a number no test can reach.
 *
 * These are roughly a third stronger than the first pass, and that was only
 * affordable because `inkDim` moved with them. §2.1 picked `#5C6479` at
 * 5.43:1 against a *flat* bone field — about nine tenths of a point of
 * headroom over AA. A wash strong enough to read as colour rather than as
 * grey costs more than that, so the honest choice was between a timid ground
 * and a darker secondary ink. `#474D62` is 7.70:1 on bare bone and still
 * 5.50:1 with both blooms stacked at full strength: a richer ground *and*
 * crisper text than before, rather than one bought with the other.
 */
export const MESH_ALPHA = [0.20, 0.15] as const;

/**
 * How much accent a quick-action tile takes on while it is held.
 *
 * The tile is `accentSoft`; pressing washes the profile's `accent` over it at
 * this alpha, so the surface moves toward the brand colour under the finger
 * instead of just getting smaller. It reads as deepening on light and as
 * brightening on dark, because the accent is a dark colour in one scheme and a
 * light one in the other — the same push toward the accent, seen from opposite
 * sides.
 *
 * 0.10 is a ceiling, not a preference. The glyph is `inkDim`, and mint on dark
 * is the case that binds: at 0.14 the pressed tile takes that mark to 4.23:1.
 * palettes.test.ts asserts both the value here and the fact that 0.14 fails.
 */
export const TILE_PRESS_ALPHA = 0.1;

// ── Shared neutrals (§2.1) ───────────────────────────────────────────────────
const LIGHT_GROUND = {
  /**
   * The tab bar.
   *
   * Both profiles get the same bar: it is a *neutral*, and the only brand
   * colour on it is the light the bead casts (see `accentGlow`).
   */
  onBar: '#12172B',     // see barTint — the bar is clear now, and reads light
  /**
   * The clear bar's own tint, over a blur of whatever is behind it.
   *
   * Not fully transparent, and it cannot be. Glass takes its contrast from
   * whatever happens to scroll underneath, which is unverifiable — and this
   * file's whole discipline is that every ratio is measured. The alpha is a
   * *floor*: it bounds how far the backdrop can drag the bar, so the worst case
   * is this ground composited over pure black or pure white, and the foreground
   * is verified against those two extremes rather than a convenient backdrop.
   *
   * 0.62 is as clear as this can go — at 0.55 the dark scheme's icons fall to
   * 3.77:1 against white content. It got there by dropping the dimmed inactive
   * state: dimming was what forced the glass opaque, since a mid-grey needs far
   * more backing than `onBar` does. The selection is marked by a capsule now,
   * so every icon can sit at full contrast and the glass can be glass.
   *
   * Lower this and the guarantee goes with it.
   */
  barTint: 'rgba(247,245,241,0.62)',
  barSelection: 'rgba(255,255,255,0.70)',
  tileSheen: 'rgba(255,255,255,0.55)',
  tileRim: 'rgba(255,255,255,0.70)',
  tileGlint: 'rgba(255,255,255,0.95)',
  ground: '#F7F5F1',      // warm bone canvas
  groundAlt: '#FFFFFF',
  groundSunk: '#EFECE6',
  ink: '#12172B',         // 16.30:1
  inkSoft: '#1B2036',     // 14.76:1 — the one dark object
  onInk: '#FFFFFF',       // 17.75:1 on ink, 16.07:1 on inkSoft
  onAccent: '#FFFFFF',    // 7.10:1 on violet accent, 5.02:1 on mint
  inkDim: '#474D62',      //  7.70:1 — see the note on MESH_ALPHA
  inkFaint: '#8A90A2',    //  2.93:1 — decoration only
  hairline: 'rgba(18,23,43,0.07)',
  positive: '#0F6B32',    //  6.08:1
  negative: '#B42318',    //  6.04:1
  warning: '#B45309',     //  4.61:1
  glowScale: 0,
} as const;

const DARK_GROUND = {
  /** The tab bar, inverted — see the light ground for the reasoning. */
  onBar: '#F5F3EF',
  /** Same floor, inverted: the darkest ground over the lightest content. */
  barTint: 'rgba(14,17,25,0.62)',
  barSelection: 'rgba(0,0,0,0.60)',
  // 0.08, not the light scheme's 0.55: see `tileSheen`. Above 0.09 the violet
  // profile's glyph drops under 4.5:1 on its own tile.
  tileSheen: 'rgba(255,255,255,0.08)',
  tileRim: 'rgba(255,255,255,0.10)',
  // Far above the rim it travels along, and further above it than in light: a
  // white glint on a near-black tile has to carry the whole effect on its own,
  // where in light the tile is already bright enough to help.
  tileGlint: 'rgba(255,255,255,0.34)',
  ground: '#0E1119',
  groundAlt: '#1A1F2C',   // RAISED — lighter than ground
  groundSunk: '#080A10',  // RECESSED — darker than ground
  ink: '#F5F3EF',         // 17.03:1
  /** The inversion: one *light* object on near-black. */
  inkSoft: '#F5F3EF',
  onInk: '#12172B',
  // Near-black, not white: the dark-scheme accents are light colours.
  onAccent: '#12172B',    // 6.52:1 on violet accent, 10.19:1 on mint
  inkDim: '#9AA0B4',      //  7.24:1
  inkFaint: '#626880',    //  3.42:1
  hairline: 'rgba(255,255,255,0.08)',
  // §2.4: the light semantics cannot be reused — #0F6B32 is 2.85:1 and
  // #B42318 is 2.87:1 here, and every spend amount in the app is set in
  // `negative`, which would make the most-read coloured text unreadable.
  positive: '#4ADE80',    // 10.83:1
  negative: '#F98B80',    //  8.12:1
  warning: '#FBBF24',     // 11.30:1
  glowScale: 0.35,
} as const;

/**
 * §2.5 — light ramp, on #F7F5F1.
 *
 * Every step still clears the 3:1 a mark has to, but each carries far more
 * chroma than the set it replaces: `#2E8377` at 0.65 saturation became
 * `#0D8577` at 0.90 for the same 4.2:1. The old ramp was muted twice over —
 * once by being dark enough to read on bone, and again by being desaturated —
 * and a category dot that has gone grey is a dot that has stopped saying
 * anything. Weight is what the contrast rule governs; chroma is free.
 */
const CAT_LIGHT = [
  '#5B3FD9', // violet 6.11
  '#1E6FD9', // blue   4.45
  '#0D8577', // teal   4.16
  '#2E8B4E', // green  3.92
  '#A87400', // amber  3.74
  '#C25A18', // orange 4.04
  '#CC3B33', // red    4.55
  '#C0357A', // pink   4.78
] as const;

/** §2.5 — dark ramp, on #0E1119. */
const CAT_DARK = [
  '#A99BE8', // violet 7.67
  '#7FB6E0', // blue   8.69
  '#5FC4B4', // teal   9.02
  '#7FC98D', // green  9.56
  '#D9B45C', // amber  9.55
  '#E0996A', // orange 8.03
  '#E58880', // red    7.34
  '#DB8FAF', // pink   7.69
] as const;

// ── Accents (§2.2, §2.3) ─────────────────────────────────────────────────────
const VIOLET_LIGHT = {
  onBarActive: '#6D28D9',  // 5.53:1 on accentSoft
  accent: '#6D28D9',      // 6.52:1
  accentPress: '#5B21B6', // 8.25:1
  accentSoft: '#E9DEFF',  // ink 14.29:1 on it; accent 5.71:1 on it
  accentMark: '#7C3AED',  // 5.23:1
  accentGlow: '#A78BFA',  // 2.50:1 — decorative only
  gradient: ['#7C3AED', '#A78BFA', '#C4B5FD'],
  // Near-black plum → vivid violet → hot magenta. White measures
  // 18.86:1 / 5.70:1 / 3.71:1.
  //
  // The middle stop is the one that decides whether this reads rich or muddy.
  // It was `#4C1D95` at 10.95:1 — dark enough that the first two-thirds of the
  // card were two barely-distinguishable purples blending into a haze. A
  // gradient needs somewhere to *travel*; this one now climbs a long way in
  // both lightness and chroma, which is what gives the surface definition.
  heroGradient: ['#1A0533', '#7C3AED', '#E040C0'],
  mesh: ['#8B5CF6', '#E879F9'],
  onHero: '#FFFFFF',
} as const;

const MINT_LIGHT = {
  onBarActive: '#0F6B32',  // 5.69:1 — accentPress, because accent is 4.31:1 there
  accent: '#15803D',      // 4.61:1
  accentPress: '#0F6B32', // 6.08:1
  accentSoft: '#D6F5E3',  // ink 15.03:1 on it
  // Mint has no legible mid-tone that is not simply the accent: #16A34A is
  // 3.03:1, which fails as a meter fill you have to read a value off. So the
  // mark *is* the accent, and the freshness lives in the gradient instead.
  accentMark: '#15803D',  // 4.61:1
  accentGlow: '#4ADE80',  // 1.60:1 — decorative only
  gradient: ['#16A34A', '#4ADE80', '#86EFAC'],
  // The mint equivalent, on the same principle: near-black pine → vivid green
  // → teal, so business reads as the same *kind* of object in another hue.
  heroGradient: ['#031C14', '#0A7D4B', '#0D9C86'],
  mesh: ['#34D399', '#2DD4BF'],
  onHero: '#FFFFFF',
} as const;

const VIOLET_DARK = {
  onBarActive: '#A78BFA',  // 5.94:1 on accentSoft
  accent: '#A78BFA',      // 6.93:1 on #0E1119
  accentPress: '#8B5CF6', // 4.46:1 — a fill, not a text colour
  accentSoft: '#241B3D',  // a wash: 1.17:1 vs ground, holds ink at 14.59:1
  accentMark: '#A78BFA',  // 6.93:1
  accentGlow: '#C4B5FD',  // 10.22:1 — high contrast here, still decorative
  gradient: ['#8B5CF6', '#A78BFA', '#C4B5FD'],
  // Dark mode inverts the hero to a *light* object (§2.4), so this is the
  // gradient for the places that still want a rich dark surface against the
  // near-black ground — lifted, not deepened, or it disappears into it.
  heroGradient: ['#240946', '#7C3AED', '#E040C0'],
  mesh: ['#7C3AED', '#C026D3'],
  onHero: '#FFFFFF',
} as const;

const MINT_DARK = {
  onBarActive: '#4ADE80',  // 9.37:1 on accentSoft
  accent: '#4ADE80',      // 10.83:1 on #0E1119
  accentPress: '#22C55E', // 8.28:1
  accentSoft: '#0F2418',  // a wash: 1.16:1 vs ground, holds ink at 14.74:1
  accentMark: '#4ADE80',  // 10.83:1
  accentGlow: '#86EFAC',  // 13.44:1 — high contrast here, still decorative
  gradient: ['#22C55E', '#4ADE80', '#86EFAC'],
  heroGradient: ['#04241A', '#0A7D4B', '#0D9C86'],
  mesh: ['#15803D', '#0D9488'],
  onHero: '#FFFFFF',
} as const;

/**
 * Legacy personal keys. Deprecated — every one is an alias onto a token
 * above. Kept so the screens that have not been redesigned yet still compile
 * and still land on the new ground.
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
 * The canonical token names, as data.
 *
 * §9 requires both profiles to expose identical keys so a component can take
 * either palette and not know which it has. The deprecated aliases cannot
 * satisfy that — `p500` and `slate900` are per-profile by construction — so
 * the contract is over these keys, and this list is what the tests check
 * against. Adding a token means adding it here.
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
] as const satisfies readonly (keyof Tokens)[];

export type Palette = Tokens & LegacyPersonal;
export type BizPalette = Tokens & LegacyBusiness;

/**
 * Build the deprecated aliases from a token set.
 *
 * Two mappings are deliberate rather than mechanical:
 *
 *   textFaint → inkDim, not inkFaint. The legacy key is used for body text at
 *   141 sites, and §2.1 forbids setting a sentence in inkFaint (2.93:1).
 *   Pointing it at inkDim costs one step of hierarchy on those screens and
 *   buys AA on all of them; `inkFaint` stays available for real decoration.
 *
 *   glassStrong stays a translucent white rather than becoming a surface. Its
 *   remaining callers paint highlights *on* the dark card (BreathingLight),
 *   where an opaque bone fill would read as a solid disc rather than a light.
 */
function legacyShared(t: Omit<Tokens, 'cat' | 'gradient' | 'heroGradient' | 'mesh'>) {
  return {
    bg: t.ground,
    bgDeep: t.ground,
    bgRaise: t.groundAlt,
    text: t.ink,
    textDim: t.inkDim,
    textFaint: t.inkDim,
    glass: t.groundAlt,
    glassStrong: t.scheme === 'light' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.10)',
    glassBorder: t.hairline,
  };
}

function personal(scheme: 'light' | 'dark'): Palette {
  const g = scheme === 'light' ? LIGHT_GROUND : DARK_GROUND;
  const a = scheme === 'light' ? VIOLET_LIGHT : VIOLET_DARK;
  const tokens: Tokens = {
    scheme,
    ...g,
    ...a,
    gradient: a.gradient,
    heroGradient: a.heroGradient,
    mesh: a.mesh,
    onHero: a.onHero,
    cat: scheme === 'light' ? CAT_LIGHT : CAT_DARK,
  };
  return {
    ...tokens,
    ...legacyShared(tokens),
    bgFoot: g.ground,
    // The violet ramp compresses: the calm direction has fewer legible
    // violets than the old neon one, so several steps land on the same value.
    // Ordering is preserved, so a gradient written [p600, p500, p400] still
    // reads dark→light.
    p950: a.accentPress, p900: a.accentPress, p800: a.accentPress,
    p700: a.accentPress, p600: a.accentPress,
    p500: a.accent,
    p400: a.accentMark, p300: a.accentMark,
    p200: a.accentSoft, lilac: a.accentGlow,
    rose: g.negative, amber: g.warning, green: g.positive,
    sky: scheme === 'light' ? CAT_LIGHT[1] : CAT_DARK[1],
  };
}

function business(scheme: 'light' | 'dark'): BizPalette {
  const g = scheme === 'light' ? LIGHT_GROUND : DARK_GROUND;
  const a = scheme === 'light' ? MINT_LIGHT : MINT_DARK;
  const tokens: Tokens = {
    scheme,
    ...g,
    ...a,
    gradient: a.gradient,
    heroGradient: a.heroGradient,
    mesh: a.mesh,
    onHero: a.onHero,
    cat: scheme === 'light' ? CAT_LIGHT : CAT_DARK,
  };
  return {
    ...tokens,
    ...legacyShared(tokens),
    slate900: g.groundAlt, slate800: g.groundSunk, slate700: g.inkFaint,
    // The old business hero was a navy gradient. It is now the one dark
    // object, flat — and in dark mode it inverts to the one light object.
    heroFrom: g.inkSoft, heroTo: g.inkSoft,
    accentDeep: a.accentPress,
    teal: g.positive, green: g.positive, amber: g.warning, red: g.negative,
  };
}

export const C_DARK: Palette = personal('dark');
export const C_LIGHT: Palette = personal('light');
export const B_DARK: BizPalette = business('dark');
export const B_LIGHT: BizPalette = business('light');

/**
 * Composite `overlay` at `alpha` over opaque `base`, returning an opaque hex.
 *
 * Lets a translucent wash be folded into the gradient stop underneath it
 * instead of being painted as a second full-width layer on top. Same pixels,
 * one less layer to composite per frame.
 *
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
