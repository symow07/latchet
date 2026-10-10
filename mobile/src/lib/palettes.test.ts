import { describe, it, expect } from 'bun:test';
import { C_DARK, C_LIGHT, B_DARK, B_LIGHT, TOKEN_KEYS, MESH_ALPHA, TILE_PRESS_ALPHA, mix, type Palette, type BizPalette } from './palettes';

/**
 * The palettes are read through the same keys — across both schemes and both
 * profiles — so a component writes `pal.ink` once and gets the right value
 * whichever is active. That only holds if all four stay in step: a key present
 * in one and missing from another is `undefined` at a style prop, which React
 * Native silently ignores rather than erroring. These tests are what notices.
 *
 * They also pin the contrast ratios DESIGN-PROMPT.md §2 states. Every number
 * in that document was measured, and §7 requires anything introduced later to
 * be measured too — so the ratios are asserted here rather than trusted to a
 * comment that can drift away from the hex beside it.
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

/** Composite an `rgba(...)` layer over a solid colour, as the glass does. */
function tintedOver(tint: string, behind: number[]): string {
  const m = tint.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!;
  const a = Number(m[4]);
  return (
    '#' +
    [1, 2, 3]
      .map((i) =>
        Math.round(Number(m[i]) * a + behind[i - 1] * (1 - a))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

/** `#rrggbb` + an alpha, the way kit.tsx builds a translucent fill. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The alpha out of an `rgba(...)` string. */
function alphaOf(rgba: string): number {
  return Number(rgba.match(/rgba?\([^)]*,\s*([\d.]+)\)$/)![1]);
}

/** Scale an `rgba(...)` layer's alpha — a sheen part-way through rolling off. */
function fade(rgba: string, factor: number): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${Number(m[4]) * factor})`;
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

/** Tokens that are not single colour strings. */
const NON_COLOUR = new Set(['scheme', 'glowScale', 'gradient', 'heroGradient', 'mesh', 'cat', 'barTint']);

describe('palettes', () => {
  it('gives both profiles identical canonical tokens', () => {
    // §9: "the two palettes drop into the codebase as objects with identical
    // keys". A component takes either one and cannot tell which it has.
    //
    // The contract is over TOKEN_KEYS, not over every key on the object: the
    // deprecated aliases are per-profile by construction — personal has p500,
    // business has slate900 — and they are on their way out.
    for (const pal of [C_LIGHT, C_DARK, B_LIGHT, B_DARK]) {
      for (const key of TOKEN_KEYS) {
        expect(pal).toHaveProperty(key);
      }
    }
    const present = (o: object) => TOKEN_KEYS.filter((k) => k in o).sort();
    expect(present(C_LIGHT)).toEqual(present(B_LIGHT));
    expect(present(C_DARK)).toEqual(present(B_DARK));
  });

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
          if (NON_COLOUR.has(key)) continue;
          expect(typeof value).toBe('string');
          expect(value as string).toMatch(/^(#[0-9a-fA-F]{6}|rgba?\()/);
        }
      });

      it('carries a three-stop gradient and an eight-step category ramp', () => {
        for (const p of [dark, light]) {
          expect(p.gradient).toHaveLength(3);
          expect(p.heroGradient).toHaveLength(3);
          expect(p.mesh).toHaveLength(2);
          expect(p.cat).toHaveLength(8);
          for (const c of [...p.gradient, ...p.heroGradient, ...p.mesh, ...p.cat]) {
            expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
          }
        }
      });

      it('keeps the hero legible where the hero has text on it', () => {
        // The ramp runs top-left → bottom-right. Everything written on the
        // card — label, amount, caption — is stacked down the left edge, so it
        // sits over the first two stops and nothing at all sits over the
        // third.
        //
        // So the requirement is not uniform, and making it uniform was a
        // mistake: it forced the vivid end dark enough to carry 13px text that
        // is never placed there, and a hero whose brightest point is capped at
        // 4.7:1 has nowhere to travel. Stops 0 and 1 keep the full AA 4.5:1;
        // stop 2 keeps the 3:1 that governs a graphical element, which is what
        // it is.
        //
        // If the layout ever moves text into that corner, this test is wrong
        // rather than merely lenient — hence the comment rather than a bare
        // number.
        for (const p of [dark, light]) {
          const [deep, mid, vivid] = p.heroGradient;
          expect(contrast(p.onHero, deep)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.onHero, mid)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.onHero, vivid)).toBeGreaterThanOrEqual(3);
        }
      });

      it('gives the hero ramp somewhere to travel', () => {
        // Definition is the point of a gradient. Three stops that all sit at a
        // similar weight blend into one flat haze — which is exactly what the
        // first attempt did, and why it read as cheap. Requiring real distance
        // between the deep end and the vivid one keeps a future tweak from
        // quietly flattening it again.
        for (const p of [dark, light]) {
          const [deep, , vivid] = p.heroGradient;
          expect(contrast(deep, vivid)).toBeGreaterThanOrEqual(3.5);
        }
      });

      it('holds its icons through the glass, in the worst case', () => {
        // The bar is a material: it shows a blur of whatever scrolls under it,
        // so its contrast is not a fixed pair of colours. What *is* fixed is
        // `barTint`'s alpha, which sets a floor — the worst background a user
        // can produce is the tint composited over the most extreme content.
        // Verified against that, not against a convenient backdrop.
        for (const p of [dark, light]) {
          for (const behind of [[0, 0, 0], [255, 255, 255]]) {
            expect(contrast(p.onBar, tintedOver(p.barTint, behind))).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('holds the selected glyph on the capsule, in the worst case', () => {
        // Two translucent layers over an unverifiable backdrop — the capsule
        // over the tint over whatever is scrolling past. Both alphas are what
        // make it measurable at all, so the glyph is checked against the whole
        // stack at its extremes rather than against the capsule alone.
        for (const p of [dark, light, C_DARK, C_LIGHT, B_DARK, B_LIGHT]) {
          for (const behind of [[0, 0, 0], [255, 255, 255]]) {
            const glass = tintedOver(p.barTint, behind);
            const bg = tintedOver(p.barSelection, hexToRgb(glass));
            expect(contrast(p.onBarActive, bg)).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('pushes the capsule away from the glyph that sits on it', () => {
        // Lighter in light, darker in dark. Backwards is not a stylistic slip:
        // a white capsule in dark mode lightens ground that is already light
        // wherever pale content scrolls under the glass, and the accent glyph
        // falls to about 1.6:1.
        const mid = [128, 128, 128];
        for (const p of [light, C_LIGHT, B_LIGHT]) {
          expect(luminance(tintedOver(p.barSelection, mid))).toBeGreaterThan(luminance(tintedOver(p.barTint, mid)));
        }
        for (const p of [dark, C_DARK, B_DARK]) {
          expect(luminance(tintedOver(p.barSelection, mid))).toBeLessThan(luminance(tintedOver(p.barTint, mid)));
        }
      });

      it('inverts the bar between schemes, because a neutral one must', () => {
        // This reverses a rule the bar was previously built on, and the reversal
        // is the point. A *brand-coloured* bar that repaints reads as two
        // different apps — that argument was right, and it is why the violet and
        // mint bars were pinned identical across schemes.
        //
        // It does not survive the bar becoming a neutral. `ink` measures 16.30:1
        // on the bone ground and 1.06:1 on the near-black one: one value cannot
        // serve both, and no lift rescues it — a navy pale enough to clear the
        // dark ground has stopped being navy. So the bar inverts like every
        // other neutral here, which is not a brand change but the same role
        // reading correctly on a different page.
        expect(light.barTint).not.toBe(dark.barTint);
        expect(light.onBar).not.toBe(dark.onBar);
        // Both profiles share it, though — the bar is neutral, and the only
        // brand colour on it is the light the bead casts.
        expect(C_LIGHT.barTint).toBe(B_LIGHT.barTint);
        expect(C_DARK.barTint).toBe(B_DARK.barTint);
      });

      it('keeps a quick-action glyph legible on its tile, at rest and held', () => {
        // The tile is `accentSoft`, the glyph is `inkDim`, and two layers move
        // over the tint: `tileSheen` at rest and the accent at
        // TILE_PRESS_ALPHA while it is held. None of it is translucent over an
        // unknown backdrop — every layer composites onto a colour this file
        // owns — so these are exact ratios rather than floors.
        //
        // Measured at each layer's *strongest* point: the sheen's first stop,
        // and the press wash fully in. The glyph sits at the tile's centre
        // under roughly half the sheen, and the drift cannot take it past that
        // stop, so the real reading is always better than what is asserted.
        for (const p of [dark, light]) {
          const held = tintedOver(withAlpha(p.accent, TILE_PRESS_ALPHA), hexToRgb(p.accentSoft));
          for (const bg of [
            p.accentSoft,
            tintedOver(p.tileSheen, hexToRgb(p.accentSoft)),
            held,
            // Held *and* still carrying what the sheen has not yet given up.
            tintedOver(fade(p.tileSheen, 0.3), hexToRgb(held)),
          ]) {
            expect(contrast(p.inkDim, bg)).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('holds the press wash under the alpha that would break it', () => {
        // 0.10 is a ceiling rather than a preference, and mint on dark is what
        // sets it: the accent there is a *light* green, so washing it over the
        // tile lightens ground that a light-grey mark is sitting on. At 0.14
        // that mark reads 4.23:1 once the sheen's remainder is counted.
        //
        // Asserted by crossing it, so raising the alpha to make the press felt
        // fails here with the reason attached rather than passing quietly.
        const worse = tintedOver(withAlpha(dark.accent, 0.14), hexToRgb(dark.accentSoft));
        const withSheen = tintedOver(fade(dark.tileSheen, 0.3), hexToRgb(worse));
        if (name === 'business') {
          expect(contrast(dark.inkDim, withSheen)).toBeLessThan(4.5);
        }
      });

      it('lights the tile from above in both schemes', () => {
        // The opposite rule to `barSelection`, and the difference is worth
        // stating because the two look like the same kind of token.
        //
        // The capsule has to push *away* from the glyph on it, so it flips with
        // the scheme. The sheen is not marking anything — it is where the light
        // falls, and light falls from above on a dark tile as much as on a pale
        // one. So it is white in both, and only the amount changes.
        for (const p of [dark, light]) {
          const lit = tintedOver(p.tileSheen, hexToRgb(p.accentSoft));
          expect(luminance(lit)).toBeGreaterThan(luminance(p.accentSoft));
        }
      });

      it('holds the dark sheen under the alpha that would break it', () => {
        // The dark figure is 0.08 against light's 0.55, which looks like a typo
        // until you work out which direction each one moves the contrast. On a
        // pale tile the glyph is dark, so a white sheen pushes the two apart. On
        // a dark tile the glyph is *light*, and the same white sheen closes the
        // gap.
        //
        // So this asserts the ceiling by crossing it. If someone raises the
        // sheen to 0.14 because the tiles look flat in dark mode, this explains
        // what broke.
        const tooMuch = tintedOver('rgba(255,255,255,0.14)', hexToRgb(dark.accentSoft));
        expect(contrast(dark.inkDim, tooMuch)).toBeLessThan(4.5);
      });

      it('makes the travelling glint brighter than the rim it travels along', () => {
        // If the two were the same the rotation would be invisible — there
        // would be nothing on the ring for the eye to follow round it.
        //
        // Both are pure white and differ only in alpha, so comparing the alphas
        // is comparing what they do. The glint is unconstrained by contrast:
        // it lives on the rim and never reaches the glyph, which is the entire
        // reason the tile's idle motion was moved out here.
        for (const p of [dark, light]) {
          expect(alphaOf(p.tileGlint)).toBeGreaterThan(alphaOf(p.tileRim));
          for (const c of [p.tileGlint, p.tileRim, p.tileSheen]) {
            expect(c).toMatch(/^rgba\(255,\s*255,\s*255,/);
          }
        }
      });

      it('shares the tile material between profiles and inverts it by scheme', () => {
        // Same shape as the bar: the sheen and the rim describe light on a
        // surface, not a brand, so both profiles get one value and the schemes
        // get different ones. The only per-profile part of a tile is the tint
        // itself and the accent it takes on under a finger — the mark on it is
        // the app's ordinary secondary ink.
        expect(light.tileSheen).not.toBe(dark.tileSheen);
        expect(C_LIGHT.tileSheen).toBe(B_LIGHT.tileSheen);
        expect(C_DARK.tileSheen).toBe(B_DARK.tileSheen);
        expect(C_LIGHT.tileRim).toBe(B_LIGHT.tileRim);
        expect(C_DARK.tileRim).toBe(B_DARK.tileRim);
      });

      it('keeps body text legible under the ambient ground wash', () => {
        // The two blooms tint the ground they sit on, and every screen's
        // secondary text is `inkDim` over exactly that. A wash strong enough
        // to feel like light in the room is also strong enough to eat that
        // token's headroom, so the budget is pinned here: composite both
        // blooms at full strength and the result must still clear AA.
        //
        // This is the constraint that decides how rich the ground can be. When
        // it started failing, the fix was not to weaken the wash but to darken
        // `inkDim` — see the note on MESH_ALPHA.
        for (const p of [dark, light]) {
          const once = mix(p.ground, p.mesh[0], MESH_ALPHA[0]);
          const twice = mix(once, p.mesh[1], MESH_ALPHA[1]);
          expect(contrast(p.inkDim, twice)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.ink, twice)).toBeGreaterThanOrEqual(7);
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

      it('inverts: the light ground is lighter than the dark one', () => {
        expect(luminance(light.ground)).toBeGreaterThan(luminance(dark.ground));
        expect(luminance(light.ink)).toBeLessThan(luminance(dark.ink));
      });

      it('raises cards above the ground and sinks wells below it', () => {
        // The first pass of §2.4 had groundSunk *lighter* than ground, so a
        // well floated. The direction is the whole meaning of the two tokens.
        expect(luminance(light.groundAlt)).toBeGreaterThan(luminance(light.ground));
        expect(luminance(light.groundSunk)).toBeLessThan(luminance(light.ground));
        expect(luminance(dark.groundAlt)).toBeGreaterThan(luminance(dark.ground));
        expect(luminance(dark.groundSunk)).toBeLessThan(luminance(dark.ground));
      });

      // The bug this catches is the one that makes a light theme unusable:
      // accents tuned to glow on black become unreadable on white.
      for (const [scheme, p] of [['dark', dark], ['light', light]] as const) {
        it(`${scheme}: body and secondary text meet WCAG AA on the ground`, () => {
          expect(contrast(p.ink, p.ground)).toBeGreaterThanOrEqual(4.5);
          // inkDim carries every secondary sentence in the app, so it is held
          // to AA rather than to the 3:1 UI threshold. inkFaint is deliberately
          // below both and is excluded here — §2.1 forbids setting a sentence
          // in it, which is a rule about usage that no palette test can check.
          expect(contrast(p.inkDim, p.ground)).toBeGreaterThanOrEqual(4.5);
        });

        it(`${scheme}: the accent is readable, and so is its mark`, () => {
          // accent carries links and small icons; accentMark carries chart
          // marks and meter fills, which are UI at 3:1.
          expect(contrast(p.accent, p.ground)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.accentMark, p.ground)).toBeGreaterThanOrEqual(3);
        });

        it(`${scheme}: the one dark object holds its own text`, () => {
          // In light this is white on near-black; in dark it inverts to
          // near-black on bone. Either way the pair has to be read together,
          // and an earlier version of this card rendered white on #dde4ef at
          // 1.28:1 because only one half of the pair inverted.
          expect(contrast(p.onInk, p.inkSoft)).toBeGreaterThanOrEqual(4.5);
        });

        it(`${scheme}: an accent fill holds its own foreground`, () => {
          // White is the wrong answer half the time: the dark-scheme accents
          // are light colours, so #fff on mint is 1.74:1. Anything filled with
          // `accent` takes its text from `onAccent` instead.
          expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.onAccent, p.accentPress)).toBeGreaterThanOrEqual(4);
        });

        it(`${scheme}: a selected row wash still holds ink`, () => {
          expect(contrast(p.ink, p.accentSoft)).toBeGreaterThanOrEqual(4.5);
        });

        it(`${scheme}: income and spend colours are legible on this ground`, () => {
          // §2.4: reusing the light semantics on the dark ground puts
          // #0F6B32 at 2.85:1 and #B42318 at 2.87:1. Every spend amount in
          // the app is set in `negative`, so that is the most-read coloured
          // text in the product — it cannot be allowed to fall through.
          expect(contrast(p.positive, p.ground)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.negative, p.ground)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.warning, p.ground)).toBeGreaterThanOrEqual(4.5);
        });

        it(`${scheme}: every category mark clears 3:1 on its own ground`, () => {
          // §2.5 ships two ramps precisely because the light one cannot be
          // reused on dark. A single shared ramp is what this catches.
          for (const c of p.cat) {
            expect(contrast(c, p.ground)).toBeGreaterThanOrEqual(3);
          }
        });

        it(`${scheme}: category marks stay distinct from one another`, () => {
          expect(new Set(p.cat).size).toBe(p.cat.length);
        });
      }
    });
  }

  it('keeps the deprecated violet ramp from reversing direction', () => {
    // Legacy screens still write gradients as [p600, p500, p400]. The ramp
    // compressed when the palette moved to the calm direction — there are
    // fewer legible violets than the neon set had, so several steps landed on
    // the same value — but it must never invert, or a hero card flips.
    for (const p of [C_DARK, C_LIGHT]) {
      const ramp = [p.p800, p.p700, p.p600, p.p500, p.p400, p.p300] as const;
      for (let i = 1; i < ramp.length; i++) {
        expect(luminance(ramp[i])).toBeGreaterThanOrEqual(luminance(ramp[i - 1]));
      }
    }
  });

  it('fades the glow on light surfaces', () => {
    // A coloured haze reads as depth on black and as grime on white. §1 drops
    // glows entirely, so light is zero rather than merely dimmer.
    expect(C_LIGHT.glowScale).toBe(0);
    expect(B_LIGHT.glowScale).toBe(0);
    expect(C_DARK.glowScale).toBeGreaterThan(C_LIGHT.glowScale);
    expect(B_DARK.glowScale).toBeGreaterThan(B_LIGHT.glowScale);
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
