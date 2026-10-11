/**
 * The identity's glyphs, as path data on a 24-unit grid.
 *
 * Drawn by hand after the approved reference (home, customers, inbox,
 * calendar): squircle containers with generous corners, round caps and joins,
 * one interior detail at most, and dots where the reference uses them as
 * texture. Every path is stroked at one weight (tokens.ts `glyphStroke`) and
 * nothing is filled except the dots.
 *
 * This set covers the sample screen. Step 2b replaces the 78 Solar duotone
 * glyphs in icon-paths.ts with this language; the generator there pulls from
 * Iconify, and no Iconify set draws these exact shapes, so these stay authored.
 *
 * Pure data, so identity.test.ts can check every path stays on the grid.
 */

export interface GlyphArt {
  /** Stroked paths. */
  strokes: readonly string[];
  /** Filled dots, as [cx, cy] on the grid. */
  dots?: readonly (readonly [number, number])[];
}

/** The squircle every container glyph is built on: 16.5 square, 4.25 corners. */
const SQUIRCLE =
  'M3.75 8a4.25 4.25 0 0 1 4.25-4.25h8A4.25 4.25 0 0 1 20.25 8v8a4.25 4.25 0 0 1-4.25 4.25H8A4.25 4.25 0 0 1 3.75 16z';

export const GLYPHS = {
  /** The reference's own house: rounded apex, soft walls, a short door. */
  home: {
    strokes: [
      'M4.25 10.6c0-.73.33-1.42.9-1.88l5.6-4.5a2 2 0 0 1 2.5 0l5.6 4.5c.57.46.9 1.15.9 1.88v7.15a3 3 0 0 1-3 3H7.25a3 3 0 0 1-3-3z',
      'M12 14.75v3.25',
    ],
  },
  /** Activity: a list, with the reference's dots as bullets. */
  activity: {
    strokes: [SQUIRCLE, 'M10.75 9.25h5.5', 'M10.75 14.75h5.5'],
    dots: [
      [7.75, 9.25],
      [7.75, 14.75],
    ],
  },
  add: { strokes: [SQUIRCLE, 'M12 8.75v6.5', 'M8.75 12h6.5'] },
  /** Insights: three bars rising inside the squircle. */
  insights: { strokes: [SQUIRCLE, 'M8.25 15.75v-2.5', 'M12 15.75v-7.5', 'M15.75 15.75v-4.5'] },
  /** Settings: two sliders, no gear teeth. */
  settings: {
    strokes: [
      'M4 8.25h9.5',
      'M17.5 8.25H20',
      'M17.5 8.25a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
      'M4 15.75h2.5',
      'M10.5 15.75H20',
      'M10.5 15.75a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    ],
  },
  /** The advisor: a speech bubble with the reference's dots for words. */
  advisor: {
    strokes: [
      'M7.75 4.25h8.5a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-5.1l-3.6 2.7c-.5.37-1.2.02-1.2-.6v-2.1a4 4 0 0 1-2.6-3.75v-6.25a4 4 0 0 1 4-4z',
    ],
    dots: [
      [8.5, 11.25],
      [12, 11.25],
      [15.5, 11.25],
    ],
  },
  scan: {
    strokes: [
      'M3.75 9.5a3.25 3.25 0 0 1 3.25-3.25h1.1c.6 0 1.1-.33 1.37-.85l.36-.7c.28-.53.83-.85 1.42-.85h1.5c.6 0 1.14.33 1.42.85l.36.7c.27.52.8.85 1.37.85H17a3.25 3.25 0 0 1 3.25 3.25v6.75A3.25 3.25 0 0 1 17 19.5H7a3.25 3.25 0 0 1-3.25-3.25z',
      'M15.25 12.75a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0z',
    ],
  },
  /** Budgets: a circle with one wedge drawn out of it. */
  budgets: {
    strokes: ['M20.25 12A8.25 8.25 0 1 1 12 3.75 8.25 8.25 0 0 1 20.25 12z', 'M12 3.75V12h8.25'],
  },
  bag: {
    strokes: [
      'M6.1 8.25h11.8c.95 0 1.7.82 1.62 1.77l-.7 8.1a2.75 2.75 0 0 1-2.74 2.5H7.92a2.75 2.75 0 0 1-2.74-2.5l-.7-8.1A1.63 1.63 0 0 1 6.1 8.25z',
      'M8.75 10.25V7.5a3.25 3.25 0 0 1 6.5 0v2.75',
    ],
  },
  cup: {
    strokes: [
      'M5.75 9.25h10v5.5a4.25 4.25 0 0 1-4.25 4.25h-1.5a4.25 4.25 0 0 1-4.25-4.25z',
      'M15.75 10.25h1a2.5 2.5 0 0 1 0 5h-1.2',
      'M8.75 3.75v2',
      'M12.75 3.75v2',
    ],
  },
  car: {
    strokes: [
      'M4.25 13.5c0-.9.4-1.7 1-2.2l1.3-3.45A2.75 2.75 0 0 1 9.12 6h5.76c1.15 0 2.17.71 2.57 1.79l1.3 3.46c.6.5 1 1.3 1 2.2v3.25c0 .97-.78 1.75-1.75 1.75H6c-.97 0-1.75-.78-1.75-1.75z',
      'M5.5 11.25h13',
      'M7.25 18.5v1.25',
      'M16.75 18.5v1.25',
    ],
    dots: [
      [8, 14.75],
      [16, 14.75],
    ],
  },
  /** Money in: an arrow landing in the reference's tray. */
  income: {
    strokes: [
      'M12 3.75v8.5',
      'M8.75 9 12 12.25 15.25 9',
      'M3.75 12.75v3a4.5 4.5 0 0 0 4.5 4.5h7.5a4.5 4.5 0 0 0 4.5-4.5v-3',
    ],
  },
  /** Subscriptions: the renewal loop. */
  repeat: {
    strokes: [
      'M5.75 10.5a6.25 6.25 0 0 1 11.6-2.25',
      'M17.75 4.75V8.5H14',
      'M18.25 13.5a6.25 6.25 0 0 1-11.6 2.25',
      'M6.25 19.25V15.5H10',
    ],
  },
  chevronRight: { strokes: ['M10 7.5l4.5 4.5-4.5 4.5'] },
} as const satisfies Record<string, GlyphArt>;

export type GlyphName = keyof typeof GLYPHS;

/** The tick the self-drawing check traces. Kept here so its length is tested. */
export const CHECK_TICK = 'M7.75 12.25l2.75 2.75 5.75-6';

/**
 * The tick's length in grid units: two straight segments, so exact.
 * strokeDasharray needs it to draw the line along itself.
 */
export const CHECK_TICK_LENGTH = Math.hypot(2.75, 2.75) + Math.hypot(5.75, 6);
