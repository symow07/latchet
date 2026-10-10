/**
 * The tab bar's geometry.
 *
 * The bar is `position: absolute`, so it is not part of any screen's layout and
 * every scrollable owes it clearance by hand. That was previously a `120`
 * guessed per screen and an `86` hardcoded in the business advisor, which was
 * wrong the moment the bar changed height — and would be wrong again on any
 * device whose home indicator differs from this one's.
 *
 * Dependency-free so all of it can be tested.
 *
 * This replaced a much larger module that computed a meniscus: the bar's top
 * edge used to rise into a socket around a bead that rode above it. That is
 * gone — the selected tab is now marked by a capsule *inside* the bar, nothing
 * protrudes, and the several hundred lines of tangent-circle geometry the swell
 * needed went with it.
 */

/**
 * `lift` subtracts from the safe-area inset rather than adding to it.
 *
 * The inset reserves room for the home indicator, and a bar that clears it
 * *entirely* floats visibly too high. The reference sits close to the bottom
 * edge, with the indicator overlapping the bar's lower margin rather than
 * pushing the whole thing up the screen. The floor keeps it off the edge on a
 * device with no inset at all.
 */
export const BAR = {
  /**
   * 72, set against the platforms rather than by eye.
   *
   *   iOS         49pt of tab bar, on the 34pt home-indicator region — 83pt of
   *               total footprint.
   *   Material 3  an 80dp navigation bar.
   *
   * A floating pill is not directly comparable to either, because it is inset
   * on all four sides and so reads smaller than a flush bar of the same height.
   * At 60 the *footprint* was already in range — 60 plus an 18pt lift is 78 —
   * while the visible chrome sat well under both standards, which is what made
   * it look undersized. 72 puts the pill itself between iOS's content height
   * and Material's full bar, for a 90pt footprint.
   */
  height: 72,
  /** Distance from the bottom of the screen to the bottom of the bar. */
  lift: (bottomInset: number) => Math.max(bottomInset - 16, 10),
  /** What a scrolling screen must leave clear beneath its last element. */
  clearance: (bottomInset: number) => BAR.height + BAR.lift(bottomInset) + 16,
} as const;

/**
 * How far the selection capsule must sit from either end of the bar.
 *
 * The bar is a pill, so its ends curve away. A capsule shorter than the bar
 * still pokes out of that curve if it is pushed flush to the end — the bar's
 * edge at the capsule's own top and bottom is further in than at its middle.
 * This is that encroachment, from the circle the cap is part of.
 */
export function capsuleInset(barHeight: number, capsuleHeight: number): number {
  'worklet';
  const r = barHeight / 2;
  const d = Math.min(r, capsuleHeight / 2);
  return r - Math.sqrt(Math.max(0, r * r - d * d));
}

/**
 * Padding for the tab row.
 *
 * The preferred layout treats `count` items as `count + 1` gaps, so the space
 * between neighbouring centres and the space from the outer centres to the
 * bar's ends are **the same number**. Laid out the obvious way — `count` equal
 * slots across the full width — the outer items get half a slot of margin while
 * their neighbours get a full one, and on a five-tab bar that reads as items
 * bunched in the middle with dead space at each end.
 *
 * The floor is whatever the selection needs to stay inside the bar's rounded
 * ends. Derived from the screen rather than hardcoded, because a value tuned on
 * one handset is wrong on the next.
 */
export function travelInset(width: number, count: number, clearance: number): number {
  'worklet';
  if (count <= 1) return 0;
  const even = width / (2 * (count + 1));
  const needed = (clearance - width / (2 * count)) / (1 - 1 / count);
  // Never more than a third of the bar; past that the tabs have nowhere to go.
  return Math.max(0, Math.min(width / 3, Math.max(even, needed)));
}

/**
 * Where tab `index`'s centre sits along the bar.
 *
 * **Mirrored under RTL, and it has to be.** The buttons live in a flex row, and
 * React Native reverses those itself when the writing direction is
 * right-to-left. This coordinate is plain arithmetic and nothing reverses it —
 * so in Arabic the selection sat at the left end over the *last* tab while the
 * active tab's own slot, at the right end, was left unmarked.
 */
export function tabCentre(
  width: number,
  pad: number,
  slot: number,
  index: number,
  rtl: boolean
): number {
  'worklet';
  const x = pad + slot * (index + 0.5);
  return rtl ? width - x : x;
}

/** The inverse: which tab a point along the bar belongs to. */
export function tabAt(
  width: number,
  pad: number,
  slot: number,
  x: number,
  count: number,
  rtl: boolean
): number {
  'worklet';
  const local = rtl ? width - x : x;
  return Math.max(0, Math.min(count - 1, Math.round((local - pad) / slot - 0.5)));
}
