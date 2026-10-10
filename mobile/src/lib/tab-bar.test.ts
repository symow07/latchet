import { describe, it, expect } from 'bun:test';
import { BAR, capsuleInset, tabAt, tabCentre, travelInset } from './tab-bar';

describe('BAR', () => {
  it('lifts the bar toward the bottom edge rather than above the inset', () => {
    // The reported bug was that the bar "looks higher than where it should be":
    // it was `Math.max(bottomInset, 12)`, which clears the home indicator
    // completely and leaves the bar floating in the middle of nothing.
    expect(BAR.lift(34)).toBe(18);
    expect(BAR.lift(34)).toBeLessThan(34);
  });

  it('never lets the bar touch the screen edge', () => {
    expect(BAR.lift(0)).toBe(10);
    expect(BAR.lift(8)).toBe(10);
  });

  it('gives a scrolling screen room to clear the bar', () => {
    for (const inset of [0, 20, 34, 48]) {
      expect(BAR.clearance(inset)).toBeGreaterThan(BAR.height + BAR.lift(inset));
    }
  });
});

describe('capsuleInset', () => {
  it('keeps the selection inside the bar\'s rounded ends', () => {
    // A capsule shorter than the bar still pokes out of the cap if pushed flush
    // to the end: the bar's edge at the capsule's top and bottom is further in
    // than at its middle. Anything less than this and the selection clips.
    const inset = capsuleInset(52, 40);
    expect(inset).toBeGreaterThan(0);
    // Geometry check against the circle the cap is part of.
    expect(inset).toBeCloseTo(26 - Math.sqrt(26 * 26 - 20 * 20), 6);
  });

  it('asks for nothing when the capsule is as tall as the bar', () => {
    // Then the capsule is the same pill as the bar and cannot poke out of it.
    expect(capsuleInset(52, 52)).toBeCloseTo(26, 6);
  });

  it('grows as the capsule gets shorter', () => {
    expect(capsuleInset(52, 20)).toBeLessThan(capsuleInset(52, 44));
  });
});

describe('travelInset', () => {
  it('spaces the ends the same as the gaps between items', () => {
    // Laid out as `count` equal slots the outer items get half a slot of margin
    // and their neighbours a full one, which reads as items bunched in the
    // middle with dead space at each end.
    for (const [width, count] of [[362, 5], [402, 5], [500, 4], [700, 6]] as const) {
      const pad = travelInset(width, count, 12);
      const slot = (width - 2 * pad) / count;
      expect(pad + slot / 2).toBeCloseTo(slot, 6);
    }
  });

  it('gives up even spacing rather than letting the selection clip', () => {
    const width = 300;
    const clearance = 70;
    const pad = travelInset(width, 5, clearance);
    const slot = (width - 2 * pad) / 5;
    expect(pad + slot / 2).toBeGreaterThanOrEqual(clearance - 0.01);
  });

  it('never starves the tabs', () => {
    const pad = travelInset(240, 5, 200);
    expect((240 - 2 * pad) / 5).toBeGreaterThan(0);
  });
});

describe('tabCentre / tabAt', () => {
  const width = 362;
  const count = 5;
  const pad = travelInset(width, count, 12);
  const slot = (width - 2 * pad) / count;

  it('mirrors the selection under RTL', () => {
    // The button row is a flex row, which React Native reverses under RTL on
    // its own, while this coordinate is arithmetic that nothing reverses. In
    // Arabic the selection sat at the far left over the last tab.
    for (let i = 0; i < count; i++) {
      expect(tabCentre(width, pad, slot, i, true)).toBeCloseTo(
        width - tabCentre(width, pad, slot, i, false),
        6
      );
    }
    expect(tabCentre(width, pad, slot, 0, false)).toBeLessThan(width / 2);
    expect(tabCentre(width, pad, slot, 0, true)).toBeGreaterThan(width / 2);
  });

  it('round-trips through tabAt in both directions', () => {
    for (const rtl of [false, true]) {
      for (let i = 0; i < count; i++) {
        expect(tabAt(width, pad, slot, tabCentre(width, pad, slot, i, rtl), count, rtl)).toBe(i);
      }
    }
  });

  it('clamps a point past either end', () => {
    for (const rtl of [false, true]) {
      expect(tabAt(width, pad, slot, -500, count, rtl)).toBeGreaterThanOrEqual(0);
      expect(tabAt(width, pad, slot, width + 500, count, rtl)).toBeLessThanOrEqual(count - 1);
    }
  });
});
