import { describe, it, expect } from 'bun:test';
import { C_DARK, C_LIGHT, B_DARK, B_LIGHT, mix, type Palette, type BizPalette } from './palettes';

/**
 * The light and dark palettes are read through the same keys, so a component
 * writes C.text once and gets the right ink either way. That only holds if the
 * two variants stay in step — a key present in one and missing from the other
 * is `undefined` at a style prop, which React Native silently ignores rather
 * than erroring. These tests are the thing that notices.
 */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [string, Palette | BizPalette, Palette | BizPalette][] = [
  ['personal', C_DARK, C_LIGHT],
  ['business', B_DARK, B_LIGHT],
];

describe('palettes', () => {
  for (const [name, dark, light] of PAIRS) {
    describe(name, () => {
      it('exposes exactly the same keys in both schemes', () => {
        expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
      });

      it('labels its own scheme', () => {
        expect(dark.scheme).toBe('dark');
        expect(light.scheme).toBe('light');
      });

      it('has no undefined or malformed colour values', () => {
        for (const [key, value] of Object.entries({ ...dark, ...light })) {
          if (key === 'scheme' || key === 'glowScale') continue;
          expect(typeof value).toBe('string');
          expect(value as string).toMatch(/^(#[0-9a-fA-F]{6}|rgba?\()/);
        }
      });

      it('actually differs between schemes', () => {
        // A palette that forgot to override anything would pass every other
        // test here while rendering an identical dark UI in light mode.
        const differing = Object.keys(dark).filter(
          (k) => dark[k as keyof typeof dark] !== light[k as keyof typeof light],
        );
        expect(differing.length).toBeGreaterThan(8);
      });

      it('inverts: the light background is lighter than the dark one', () => {
        expect(luminance(light.bg)).toBeGreaterThan(luminance(dark.bg));
        expect(luminance(light.text)).toBeLessThan(luminance(dark.text));
      });

      // The bug this catches is the one that makes a light theme unusable:
      // accents tuned to glow on black become unreadable on white.
      for (const [scheme, p] of [['dark', dark], ['light', light]] as const) {
        it(`${scheme}: body text meets WCAG AA against its own background`, () => {
          expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
        });

        it(`${scheme}: dimmed text stays legible against its own background`, () => {
          // AA large-text / UI-component threshold; textDim is used for
          // secondary copy that still has to be readable.
          expect(contrast(p.textDim, p.bg)).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }

  it('personal: the primary accent is readable on its own background', () => {
    // C.p500 is used for icons and emphasis text on the page background.
    expect(contrast(C_DARK.p500, C_DARK.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(C_LIGHT.p500, C_LIGHT.bg)).toBeGreaterThanOrEqual(3);
  });

  it('business: the primary accent is readable on its own background', () => {
    expect(contrast(B_DARK.accent, B_DARK.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(B_LIGHT.accent, B_LIGHT.bg)).toBeGreaterThanOrEqual(3);
  });

  it('keeps each shade ramp ordered light-to-dark in both schemes', () => {
    // Gradients are written [p600, p500, p400] and must not reverse direction
    // between schemes, or a hero card inverts.
    for (const p of [C_DARK, C_LIGHT]) {
      const ramp = [p.p800, p.p700, p.p600, p.p500, p.p400, p.p300] as const;
      for (let i = 1; i < ramp.length; i++) {
        expect(luminance(ramp[i])).toBeGreaterThan(luminance(ramp[i - 1]));
      }
    }
  });

  it('keeps the business hero dark enough for the white text on it', () => {
    // These cards carry white text in both schemes, so unlike every other
    // surface they must NOT invert. They were derived from slate800, which
    // does invert, and light mode rendered white on #dde4ef at 1.28:1.
    for (const p of [B_DARK, B_LIGHT]) {
      expect(contrast('#ffffff', p.heroFrom)).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#ffffff', p.heroTo)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('fades the glow on light surfaces', () => {
    // A coloured haze reads as depth on black and as grime on white.
    expect(C_LIGHT.glowScale).toBeLessThan(C_DARK.glowScale);
    expect(B_LIGHT.glowScale).toBeLessThan(B_DARK.glowScale);
  });
});

describe('mix', () => {
  it('returns the base at alpha 0 and the overlay at alpha 1', () => {
    expect(mix('#0c0716', '#4c1d95', 0)).toBe('#0c0716');
    expect(mix('#0c0716', '#4c1d95', 1)).toBe('#4c1d95');
  });

  it('produces the page-gradient stops ScreenBackground depends on', () => {
    // ScreenBackground folded a second full-width wash into this gradient's
    // last stop. The alphas are fitted to what the two-layer version actually
    // rendered rather than to its nominal geometry — its box is taller than
    // the visible screen, so the wash never reached its end colour. Pinning
    // both stops here means a change to mix() cannot silently shift the
    // background out from under that measurement.
    expect(mix('#0c0716', '#120a20', 0.67)).toBe('#10091d');
    expect(mix('#120a20', '#4c1d95', 0.086)).toBe('#170c2a');
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
