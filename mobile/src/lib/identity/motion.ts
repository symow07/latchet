/**
 * The Budget identity — motion spec.
 *
 * Fast, soft, eased, purposeful. Every duration is under 300 ms, every curve
 * arrives without overshoot, and nothing springs. Motion here has four jobs and
 * no others:
 *
 *   press    — tells a finger the tap landed before the screen changes;
 *   settle   — content arrives in reading order instead of all at once;
 *   count-up — a number that changed shows that it changed;
 *   check    — a completed thing draws its own check.
 *
 * Anything that moves for any other reason is decoration, and decoration is
 * what the old identity had too much of (an 11 s rim glint, 400 ms springs,
 * a 900 ms arc). identity.test.ts holds every value below to these rules.
 *
 * Pure data with no React Native imports. The components turn the curves into
 * Reanimated easings with `Easing.bezier(...EASE.out)`.
 */

/** A cubic-bezier as [x1, y1, x2, y2]. */
export type Bezier = readonly [number, number, number, number];

/** The four durations, in ms. There is no fifth. */
export const DURATION = {
  /** Press-in. Has to beat the finger lifting. */
  tap: 90,
  /** Release, chip toggles, crossfades. */
  quick: 160,
  /** Settling content. */
  base: 200,
  /** Count-ups, drawing checks, progress. The ceiling. */
  slow: 280,
} as const;

/** The hard limit the brief sets: every animation finishes inside this. */
export const MOTION_CEILING_MS = 300;

export const EASE = {
  /**
   * Arrives fast and settles softly (an ease-out-quint). The default for
   * anything entering or changing to a new value.
   */
  out: [0.22, 1, 0.36, 1],
  /** For state that moves both ways: toggles, a progress line re-measuring. */
  inOut: [0.65, 0, 0.35, 1],
  /** Press-in: a quick, firm start. */
  press: [0.2, 0, 0, 1],
  /** Leaving: accelerates away, so the next thing is not kept waiting. */
  exit: [0.4, 0, 1, 1],
} as const satisfies Record<string, Bezier>;

export type EaseName = keyof typeof EASE;

export interface Tween {
  duration: number;
  ease: EaseName;
  delay?: number;
}

export const MOTION = {
  press: {
    /** Scale while held. A shrinking surface reads as pressed; a dimming one reads as disabled. */
    scale: 0.97,
    in: { duration: DURATION.tap, ease: 'press' },
    out: { duration: DURATION.quick, ease: 'out' },
  },
  settle: {
    /** Points travelled upward while fading in. */
    distance: 8,
    tween: { duration: DURATION.base, ease: 'out' },
    /** Gap between consecutive blocks. */
    stagger: 30,
    /** Blocks past this one arrive with the last, so a long screen still lands in time. */
    maxStaggered: 4,
  },
  countUp: { duration: DURATION.slow, ease: 'out' },
  check: {
    /** The ring tints first, then the tick draws itself along its own length. */
    ring: { duration: DURATION.quick, ease: 'out' },
    tick: { duration: 240, ease: 'out', delay: 40 },
  },
  progress: { duration: DURATION.slow, ease: 'inOut' },
  crossfade: { duration: DURATION.quick, ease: 'inOut' },
  /** A control's selection moving across (a segmented pill, a tab capsule). */
  slide: { duration: DURATION.base, ease: 'inOut' },
  /** A sheet rises in 280 and leaves, accelerating, in 200. */
  sheet: {
    open: { duration: DURATION.slow, ease: 'out' },
    close: { duration: DURATION.base, ease: 'exit' },
  },
  /**
   * With Reduce Motion on: nothing travels or scales. Settles become a plain
   * fade, count-ups show their value, checks appear already drawn.
   */
  reduced: { fade: { duration: DURATION.quick, ease: 'inOut' } },
} as const;

/** When the settle of block `index` starts. */
export function settleDelay(index: number): number {
  return Math.min(Math.max(index, 0), MOTION.settle.maxStaggered - 1) * MOTION.settle.stagger;
}

/** When the last of `blocks` settled blocks finishes. */
export function choreographyEnd(blocks: number): number {
  return settleDelay(blocks - 1) + MOTION.settle.tween.duration;
}

/**
 * True when a curve leaves the 0–1 range, which is what makes a value overshoot
 * its target and come back, the "bounce" the brief rules out.
 */
export function overshoots(b: Bezier): boolean {
  return b[1] < 0 || b[1] > 1 || b[3] < 0 || b[3] > 1;
}

/**
 * Haptics. Paired with motion, never a substitute for it.
 *   selection — a press that navigates or toggles;
 *   success   — a check finishing (once, at the end of the draw);
 *   none      — scrolling, settles, count-ups.
 */
export const HAPTIC = {
  press: 'selection',
  check: 'success',
} as const;
