import { describe, it, expect } from 'bun:test';
import {
  B_DARK,
  B_LIGHT,
  C_DARK,
  C_LIGHT,
  P_DARK,
  P_LIGHT,
  TOKEN_KEYS,
  mix,
  type Palette,
} from './palettes';
import { DARK as I_DARK, LIGHT as I_LIGHT } from './identity/tokens';

/**
 * The palette every screen reads, built from the design identity
 * (DESIGN-IDENTITY.md, lib/identity/tokens.ts).
 *
 * The identity replaced a violet personal theme and a green business theme
 * with one palette. These tests pin that: the profiles are one object, nothing
 * violet or mint survives in it, and every role a screen reads clears the
 * contrast its job needs, in both schemes. identity.test.ts holds the identity
 * tokens themselves; this file holds the mapping of the app's long-standing
 * key names onto them.
 */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite an `rgba(...)` layer over a solid colour, as the glass does. */
function over(tint: string, behind: string): string {
  const m = tint.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!;
  const a = Number(m[4]);
  const b = hexToRgb(behind);
  return (
    '#' +
    [1, 2, 3]
      .map((i) => Math.round(Number(m[i]) * a + b[i - 1] * (1 - a)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Hue in degrees and HSL saturation, for the "no violet, no green" check. */
function hueSat(hex: string): [number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d === 0) return [0, 0];
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s];
}

/** The smallest RGB distance between any two values in a ramp. */
function minSpacing(ramp: readonly string[]): number {
  let min = Infinity;
  for (let i = 0; i < ramp.length; i++) {
    for (let j = i + 1; j < ramp.length; j++) {
      const [a, b] = [hexToRgb(ramp[i]!), hexToRgb(ramp[j]!)];
      min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return min;
}

const CAT_SPACING_FLOOR = 16;

const SCHEMES: [string, Palette][] = [
  ['light', P_LIGHT],
  ['dark', P_DARK],
];

/** Every single-colour hex value in a palette, legacy aliases included. */
function hexValues(p: Palette): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)) out.push([k, v]);
    if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'string' && out.push([`${k}[${i}]`, x]));
  }
  return out;
}

describe('one identity', () => {
  it('gives personal and business the very same palette object', () => {
    expect(C_LIGHT).toBe(P_LIGHT);
    expect(B_LIGHT).toBe(P_LIGHT);
    expect(C_DARK).toBe(P_DARK);
    expect(B_DARK).toBe(P_DARK);
  });

  it('exposes every canonical key in both schemes', () => {
    for (const [, p] of SCHEMES) {
      for (const k of TOKEN_KEYS) expect(p[k], k).toBeDefined();
    }
  });

  it('has no undefined or malformed colour values', () => {
    // hexValues() below only collects well-formed hex, so a malformed value
    // would slip past every contrast check silently. This one catches it.
    for (const [scheme, p] of SCHEMES) {
      for (const [k, v] of Object.entries(p)) {
        expect(v, `${scheme}.${k}`).toBeDefined();
        if (typeof v === 'string' && k !== 'scheme') {
          expect(
            /^#[0-9A-Fa-f]{6}$/.test(v) || /^rgba\(\d{1,3}, ?\d{1,3}, ?\d{1,3}, ?(0|1|0?\.\d+)\)$/.test(v),
            `${scheme}.${k} = ${v}`
          ).toBe(true);
        }
      }
    }
  });

  it('exposes exactly the same keys in both schemes, and labels each', () => {
    expect(Object.keys(P_DARK).sort()).toEqual(Object.keys(P_LIGHT).sort());
    expect(P_LIGHT.scheme).toBe('light');
    expect(P_DARK.scheme).toBe('dark');
  });

  it('actually differs between schemes, and inverts the page and the bar', () => {
    expect(P_DARK.ground).not.toBe(P_LIGHT.ground);
    expect(P_DARK.ink).not.toBe(P_LIGHT.ink);
    expect(luminance(P_LIGHT.ground)).toBeGreaterThan(luminance(P_DARK.ground));
    // A neutral glass has to invert with the page or its glyphs sink into it.
    expect(P_DARK.barTint).not.toBe(P_LIGHT.barTint);
  });

  it('carries a three-stop silver sheen and an eight-step category ramp', () => {
    for (const [, p] of SCHEMES) {
      expect(p.gradient.length).toBe(3);
      expect(p.gradient[0]).toBe(p.silverHi);
      expect(p.cat.length).toBe(8);
    }
  });

  it('carries the identity tokens unchanged', () => {
    expect(P_LIGHT.ground).toBe(I_LIGHT.ground);
    expect(P_LIGHT.groundAlt).toBe(I_LIGHT.surface);
    expect(P_LIGHT.espresso).toBe(I_LIGHT.espresso);
    expect(P_DARK.espresso).toBe(I_DARK.espresso);
    expect(P_LIGHT.inkSoft).toBe(I_LIGHT.espresso);
    expect(P_DARK.silver).toBe(I_DARK.silver);
  });

  it('keeps no violet and no theme green anywhere in it', () => {
    const OLD = [
      '#6D28D9', '#5B21B6', '#E9DEFF', '#7C3AED', '#A78BFA', '#C4B5FD', '#8B5CF6', '#241B3D',
      '#15803D', '#0F6B32', '#D6F5E3', '#4ADE80', '#86EFAC', '#22C55E', '#0F2418', '#16A34A',
      '#1A0533', '#E040C0', '#031C14', '#0A7D4B', '#0D9C86', '#F7F5F1', '#12172B', '#0E1119',
    ];
    for (const [, p] of SCHEMES) {
      for (const [k, v] of hexValues(p)) {
        expect(OLD, k).not.toContain(v.toUpperCase());
        const [h, s] = hueSat(v);
        // Violet and magenta: any noticeable saturation in 250–330°.
        expect(h >= 250 && h <= 330 && s > 0.2, `${k} ${v} is violet`).toBe(false);
        // Theme green is gone; the one green allowed is `positive` (money in)
        // and its alias names.
        if (!['positive', 'green', 'teal'].includes(k)) {
          expect(h >= 90 && h <= 170 && s > 0.2, `${k} ${v} is green`).toBe(false);
        }
      }
    }
  });

  it('flattens the retired gradient, blooms and glows', () => {
    for (const [, p] of SCHEMES) {
      expect(new Set(p.heroGradient).size).toBe(1);
      expect(p.heroGradient[0]).toBe(p.espresso);
      expect(p.mesh).toEqual([p.ground, p.ground]);
      expect(p.glowScale).toBe(0);
    }
  });
});

describe('contrast', () => {
  for (const [scheme, p] of SCHEMES) {
    it(`${scheme}: text roles clear 4.5:1 on the page and on cards`, () => {
      for (const role of ['ink', 'inkDim', 'accent', 'positive', 'negative', 'warning'] as const) {
        expect(contrast(p[role], p.ground), role).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p[role], p.groundAlt), role).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${scheme}: every fill holds the text that sits on it`, () => {
      expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onInk, p.ink)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onEspresso, p.espresso)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onEspressoDim, p.espresso)).toBeGreaterThanOrEqual(4.5);
      for (const stop of p.heroGradient) expect(contrast(p.onHero, stop)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, p.accentSoft)).toBeGreaterThanOrEqual(4.5);
      // A selected row or chip is a tint wash under ink.
      expect(contrast(p.ink, p.accentSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.ink, p.groundSunk)).toBeGreaterThanOrEqual(4.5);
      // A quick-action or row glyph sits in ink on a silver tile.
      expect(contrast(p.ink, p.silverSoft)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scheme}: tab glyphs hold through the glass, whatever scrolls beneath`, () => {
      for (const beneath of ['#000000', '#FFFFFF']) {
        const glass = over(p.barTint, beneath);
        expect(contrast(p.onBar, glass)).toBeGreaterThanOrEqual(3);
        expect(contrast(p.onBarActive, p.barSelection)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${scheme}: every chart and account mark clears 3:1 on its ground`, () => {
      expect(p.cat.length).toBe(8);
      for (const c of p.cat) expect(contrast(c, p.ground), c).toBeGreaterThanOrEqual(3);
      expect(new Set(p.cat).size).toBe(8);
    });

    it(`${scheme}: no two category marks are near-duplicates`, () => {
      // Unique is not enough: dark caramel once sat 11.7 RGB units from cocoa,
      // so two accounts in those positions read as one colour. 16 is the
      // floor; the closest pair today is about 16 in dark and 20 in light.
      expect(minSpacing(p.cat)).toBeGreaterThanOrEqual(CAT_SPACING_FLOOR);
    });
  }

  it('lifts cards off the page, and wells in dark sit above cards, not below', () => {
    // Light: the card is lighter than the page, the well darker.
    expect(luminance(P_LIGHT.groundAlt)).toBeGreaterThan(luminance(P_LIGHT.ground));
    expect(luminance(P_LIGHT.groundSunk)).toBeLessThan(luminance(P_LIGHT.ground));
    // Dark: cards rise above the page, and wells rise above cards (a well
    // darker than a dark card reads as a hole).
    expect(luminance(P_DARK.groundAlt)).toBeGreaterThan(luminance(P_DARK.ground));
    expect(luminance(P_DARK.groundSunk)).toBeGreaterThan(luminance(P_DARK.groundAlt));
  });
});

describe('category spacing floor', () => {
  it('fails the near-duplicate it was written for (control)', () => {
    const before = [...P_DARK.cat];
    before[3] = '#C9AE84';
    expect(minSpacing(before)).toBeLessThan(CAT_SPACING_FLOOR);
  });
});

describe('legacy aliases', () => {
  it('point at the identity roles that now do their jobs', () => {
    for (const [, p] of SCHEMES) {
      expect(p.textFaint).toBe(p.inkDim); // body text never in inkFaint
      expect(p.p500).toBe(p.accent);
      expect(p.teal).toBe(p.positive);
      expect(p.green).toBe(p.positive);
      expect(p.red).toBe(p.negative);
      expect(p.rose).toBe(p.negative);
      expect(p.heroFrom).toBe(p.espresso);
      expect(p.bg).toBe(p.ground);
    }
  });
});

describe('mix', () => {
  it('returns the base at alpha 0 and the overlay at alpha 1', () => {
    expect(mix('#0c0716', '#4c1d95', 0)).toBe('#0c0716');
    expect(mix('#0c0716', '#4c1d95', 1)).toBe('#4c1d95');
  });

  it('blends linearly per channel', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#F6F3EF', '#3B2A21', 0.25)).toBe('#c7c1bc');
  });

  it('clamps alpha rather than producing out-of-range channels', () => {
    expect(mix('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', -1)).toBe('#000000');
  });

  it('always returns a 6-digit hex, zero-padding low channels', () => {
    const out = mix('#000000', '#0a0a0a', 0.5);
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(out).toBe('#050505');
  });
});
