import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BAR_TINT_ALPHA,
  DARK,
  DARK_SHADOW_GAIN,
  ELEVATION,
  GLYPH,
  LIGHT,
  PALETTES,
  contrast,
  glyphStroke,
  luminance,
  over,
  type IdentityPalette,
} from './tokens';
import {
  DURATION,
  EASE,
  MOTION,
  MOTION_CEILING_MS,
  choreographyEnd,
  overshoots,
  settleDelay,
} from './motion';
import { CHECK_TICK_LENGTH, GLYPHS } from './glyph-paths';

const SCHEMES: IdentityPalette[] = [LIGHT, DARK];
const colours = (p: IdentityPalette) =>
  Object.entries(p).filter((e): e is [string, string] => typeof e[1] === 'string' && e[0] !== 'scheme');

describe('palette', () => {
  test('both schemes define the same roles', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    expect(PALETTES.light).toBe(LIGHT);
    expect(PALETTES.dark).toBe(DARK);
  });

  test('every colour is 6-digit hex, because kit.tsx and mix() append alpha', () => {
    for (const p of SCHEMES) for (const [, v] of colours(p)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
  });

  test('the ground is off-white, never bright white, and so is the brightest surface', () => {
    expect(LIGHT.ground).not.toBe('#FFFFFF');
    expect(luminance(LIGHT.ground)).toBeLessThan(0.92);
    for (const [, v] of colours(LIGHT)) expect(luminance(v)).toBeLessThan(0.95);
  });

  test('the violet and green of the old dual theme are gone', () => {
    const old = ['#6D28D9', '#5B21B6', '#7C3AED', '#A78BFA', '#8B5CF6', '#E9DEFF', '#15803D', '#0F6B32', '#4ADE80', '#22C55E', '#D6F5E3'];
    for (const p of SCHEMES) for (const [, v] of colours(p)) expect(old).not.toContain(v);
  });

  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hue = (h: string) => {
    const [r, g, b] = rgb(h).map((c) => c / 255);
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (x * 60 + 360) % 360;
  };
  const richness = (h: string) => {
    const c = rgb(h);
    return (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  };

  test('espresso is a brown in both schemes', () => {
    for (const p of SCHEMES) {
      const [r, g, b] = rgb(p.espresso);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
  });

  test('silver is a warm, neutral platinum: never blue, never beige', () => {
    const roles = ['silver', 'silverHi', 'silverEdge', 'silverSoft', 'silverInk', 'onEspressoDim'] as const;
    for (const p of SCHEMES) {
      for (const role of roles) {
        const [r, g, b] = rgb(p[role]);
        // Blue never leads: red at or above blue, green between them.
        expect(b, `${p.scheme}.${role}`).toBeLessThanOrEqual(r);
        expect(b, `${p.scheme}.${role}`).toBeLessThanOrEqual(g);
        // Neutral: a platinum, not a stone or a sand.
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${p.scheme}.${role}`).toBeLessThanOrEqual(10);
      }
    }
    // Control: the cool silver this replaced fails the first rule.
    const [r, , b] = rgb('#B9BFC6');
    expect(b).toBeGreaterThan(r);
  });

  test('the dark anchor is the light espresso, deepened: same hue, no less rich, still lifted', () => {
    expect(Math.abs(hue(DARK.espresso) - hue(LIGHT.espresso))).toBeLessThanOrEqual(3);
    expect(richness(DARK.espresso)).toBeGreaterThanOrEqual(richness(LIGHT.espresso));
    expect(contrast(DARK.espresso, DARK.ground)).toBeGreaterThanOrEqual(1.5);
    // Control: the taupe it replaced was less rich than the light espresso.
    expect(richness('#4E392D')).toBeLessThan(richness(LIGHT.espresso));
  });
});

describe('contrast', () => {
  const TEXT = ['ink', 'inkSoft', 'inkDim', 'tint', 'positive', 'negative', 'warning'] as const;

  for (const p of SCHEMES) {
    test(`${p.scheme}: every text role clears 4.5:1 on the ground and on surfaces`, () => {
      for (const role of TEXT) {
        expect(contrast(p[role], p.ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p[role], p.surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${p.scheme}: text on espresso clears 4.5:1, including the silver secondary`, () => {
      expect(contrast(p.onEspresso, p.espresso)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onEspressoDim, p.espresso)).toBeGreaterThanOrEqual(4.5);
    });

    test(`${p.scheme}: a selected chip's text clears 4.5:1 on its wash`, () => {
      expect(contrast(p.tint, p.tintSoft)).toBeGreaterThanOrEqual(4.5);
    });

    test(`${p.scheme}: graphics clear 3:1: glyphs on tiles, silver on espresso, silverInk on the ground`, () => {
      expect(contrast(p.inkSoft, p.sunk)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.silver, p.espresso)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.silverInk, p.ground)).toBeGreaterThanOrEqual(3);
    });

    test(`${p.scheme}: tab glyphs clear 3:1 over the bar's tint whatever scrolls beneath it`, () => {
      for (const beneath of ['#000000', '#FFFFFF']) {
        const bar = over(p.barTint, BAR_TINT_ALPHA[p.scheme], beneath);
        expect(contrast(p.inkDim, bar)).toBeGreaterThanOrEqual(3);
        expect(contrast(p.tint, over(p.tintSoft, 1, bar))).toBeGreaterThanOrEqual(3);
      }
    });
  }

  test('the light anchor stands well clear of the page', () => {
    expect(contrast(LIGHT.espresso, LIGHT.ground)).toBeGreaterThanOrEqual(7);
  });

  test('the contrast helper agrees with known WCAG values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
    expect(over('#000000', 0.5, '#FFFFFF')).toBe('#808080');
  });
});

describe('depth', () => {
  test('every lifted surface casts two layers: a tight contact shadow under a wide ambient one', () => {
    for (const [name, [contact, ambient]] of Object.entries(ELEVATION)) {
      expect(contact.y, name).toBeGreaterThan(0);
      expect(contact.blur, name).toBeGreaterThan(0);
      expect(ambient.y, name).toBeGreaterThan(contact.y);
      expect(ambient.blur, name).toBeGreaterThan(contact.blur * 2);
    }
  });

  test('depth stays calm: no layer is heavy, even with the dark gain', () => {
    for (const layers of Object.values(ELEVATION)) {
      for (const s of layers) {
        expect(s.opacity).toBeLessThanOrEqual(0.3);
        expect(Math.min(s.opacity * DARK_SHADOW_GAIN, 0.9)).toBeLessThanOrEqual(0.9);
      }
    }
  });

  test('the anchor floats highest', () => {
    expect(ELEVATION.anchor[1].y).toBeGreaterThan(ELEVATION.raised[1].y);
    expect(ELEVATION.raised[1].y).toBeGreaterThan(ELEVATION.rest[1].y);
  });

  test('light shadows are espresso, so depth stays warm', () => {
    expect(LIGHT.shadow).toBe(LIGHT.espresso);
  });
});

describe('silver', () => {
  for (const p of SCHEMES) {
    test(`${p.scheme}: the silver edge is visible against cards and the page`, () => {
      expect(contrast(p.silverEdge, p.surface)).toBeGreaterThanOrEqual(1.4);
      expect(contrast(p.silverEdge, p.ground)).toBeGreaterThanOrEqual(1.3);
    });

    test(`${p.scheme}: the silver figure on espresso reads as text`, () => {
      expect(contrast(p.silver, p.espresso)).toBeGreaterThanOrEqual(4.5);
    });

    test(`${p.scheme}: the sheen is the bright end of silver`, () => {
      expect(luminance(p.silverHi)).toBeGreaterThan(luminance(p.silver));
    });
  }
});

describe('money colours', () => {
  const hue = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (x * 60 + 360) % 360;
  };

  for (const p of SCHEMES) {
    test(`${p.scheme}: income is green and spending is red, the convention kept`, () => {
      expect(hue(p.positive)).toBeGreaterThan(100);
      expect(hue(p.positive)).toBeLessThan(160);
      const red = hue(p.negative);
      expect(red < 15 || red > 345).toBe(true);
    });
  }
});

describe('motion', () => {
  test('every duration is under the 300 ms ceiling', () => {
    for (const d of Object.values(DURATION)) expect(d).toBeLessThan(MOTION_CEILING_MS);
  });

  test('every tween, delay included, finishes under the ceiling', () => {
    const tweens = [
      MOTION.press.in,
      MOTION.press.out,
      MOTION.settle.tween,
      MOTION.countUp,
      MOTION.check.ring,
      MOTION.progress,
      MOTION.crossfade,
      MOTION.slide,
      MOTION.sheet.open,
      MOTION.sheet.close,
      MOTION.reduced.fade,
    ];
    for (const t of tweens) expect(t.duration).toBeLessThan(MOTION_CEILING_MS);
    expect(MOTION.check.tick.delay + MOTION.check.tick.duration).toBeLessThan(MOTION_CEILING_MS);
  });

  test('a screen of settling blocks lands inside the ceiling however long it is', () => {
    expect(choreographyEnd(4)).toBeLessThan(MOTION_CEILING_MS);
    expect(choreographyEnd(40)).toBe(choreographyEnd(MOTION.settle.maxStaggered));
    expect(settleDelay(0)).toBe(0);
    expect(settleDelay(-3)).toBe(0);
  });

  test('no curve overshoots, so nothing bounces', () => {
    for (const b of Object.values(EASE)) expect(overshoots(b)).toBe(false);
    expect(overshoots([0.34, 1.56, 0.64, 1])).toBe(true);
  });

  test('press feedback is a small shrink, not a pop', () => {
    expect(MOTION.press.scale).toBeGreaterThanOrEqual(0.95);
    expect(MOTION.press.scale).toBeLessThan(1);
  });

  test('the identity components never spring and never hard-code a duration', () => {
    const src = readFileSync(join(import.meta.dir, '../../components/identity/primitives.tsx'), 'utf8');
    expect(src).not.toMatch(/withSpring|withDecay|Easing\.(bounce|elastic|back)/);
    const durations = [...src.matchAll(/duration:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(durations.every((d) => d === 0)).toBe(true);
  });
});

/** Every absolute point a path visits, endpoints and control points included. */
function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toLowerCase()) {
      case 'm':
      case 'l': {
        x = ox + num();
        y = oy + num();
        if (cmd.toLowerCase() === 'm') {
          sx = x;
          sy = y;
          cmd = rel ? 'l' : 'L';
        }
        pts.push([x, y]);
        break;
      }
      case 'h':
        x = (rel ? x : 0) + num();
        pts.push([x, y]);
        break;
      case 'v':
        y = (rel ? y : 0) + num();
        pts.push([x, y]);
        break;
      case 'c': {
        for (let k = 0; k < 2; k++) pts.push([ox + num(), oy + num()]);
        x = ox + num();
        y = oy + num();
        pts.push([x, y]);
        break;
      }
      case 's': {
        pts.push([ox + num(), oy + num()]);
        x = ox + num();
        y = oy + num();
        pts.push([x, y]);
        break;
      }
      case 'a': {
        i += 5; // rx ry rotation large-arc sweep
        x = ox + num();
        y = oy + num();
        pts.push([x, y]);
        break;
      }
      case 'z':
        x = sx;
        y = sy;
        break;
      default:
        throw new Error(`unhandled path command ${cmd} in ${d}`);
    }
  }
  return pts;
}

describe('glyphs', () => {
  test('the path reader handles every command the set uses', () => {
    expect(pathPoints('M1 2h3v4l-1 1z')).toEqual([
      [1, 2],
      [4, 2],
      [4, 6],
      [3, 7],
    ]);
  });

  for (const [name, art] of Object.entries(GLYPHS)) {
    test(`${name} stays on the 24 grid with a margin for the stroke`, () => {
      expect(art.strokes.length).toBeGreaterThan(0);
      for (const d of art.strokes) {
        for (const [px, py] of pathPoints(d)) {
          expect(px).toBeGreaterThanOrEqual(2);
          expect(px).toBeLessThanOrEqual(22);
          expect(py).toBeGreaterThanOrEqual(2);
          expect(py).toBeLessThanOrEqual(22);
        }
      }
      for (const [cx, cy] of 'dots' in art ? art.dots : []) {
        expect(cx).toBeGreaterThan(3);
        expect(cx).toBeLessThan(21);
        expect(cy).toBeGreaterThan(3);
        expect(cy).toBeLessThan(21);
      }
    });
  }

  test('the Glyph component strokes with round caps and joins and fills nothing but dots', () => {
    const src = readFileSync(join(import.meta.dir, '../../components/identity/primitives.tsx'), 'utf8');
    const glyph = src.slice(src.indexOf('export function Glyph'), src.indexOf('// ── Press'));
    expect(glyph).toContain('strokeLinecap="round"');
    expect(glyph).toContain('strokeLinejoin="round"');
    expect(glyph.match(/fill=\{color\}/g)?.length).toBe(1);
    expect(glyph).toContain('<Circle');
  });

  test('a glyph keeps its weight: the reference stroke at 24pt, never thinner than the floor', () => {
    expect(glyphStroke(24)).toBeCloseTo(GLYPH.stroke, 5);
    expect(GLYPH.stroke).toBeCloseTo(1.2, 5);
    for (const size of [14, 18, 22, 26, 32]) {
      expect((glyphStroke(size) * size) / GLYPH.grid).toBeGreaterThanOrEqual(GLYPH.minStrokePt - 1e-9);
    }
  });

  test('the check tick length matches its two segments', () => {
    expect(CHECK_TICK_LENGTH).toBeCloseTo(Math.SQRT2 * 2.75 + Math.hypot(5.75, 6), 6);
  });
});
