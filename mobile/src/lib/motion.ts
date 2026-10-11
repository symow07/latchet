/**
 * Motion constants and the pure maths behind them.
 *
 * Kept native-free so the curves can be tested without a simulator; the
 * components live in components/motion.tsx.
 *
 * One authored moment, not scattered effects. The app already had seventy
 * identical FadeInUp entrances across seventeen files, which is why nothing
 * read as a peak — when every section arrives the same way, none of them
 * arrives. So: the balance is the moment, press is feedback, and everything
 * else stays still.
 */
import { MOTION } from './identity/motion';

/** Exponential ease-out. Fast departure, long settle — the shape of something
 *  arriving under its own weight rather than being placed. */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

/** The value a counting number shows at a given moment. */
export function countAt(target: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return target;
  return target * easeOutExpo(elapsedMs / durationMs);
}

/**
 * How long a number should take to count: the identity's count-up, 280 ms,
 * whatever the magnitude. The design identity caps every animation under
 * 300 ms (DESIGN-IDENTITY.md §Motion); a count is there to show that a figure
 * changed, not to make anyone wait to read it. Zero has nothing to count.
 */
export function countDuration(target: number): number {
  return target === 0 ? 0 : MOTION.countUp.duration;
}

/** Press feedback. Enough to feel, not enough to notice. */
export const PRESS_SCALE = MOTION.press.scale;

// ── Locale-safe formatting inside a worklet ──────────────────────────────────

/**
 * The pieces of a formatted currency string.
 *
 * Intl.NumberFormat cannot run on the UI thread, and a counting number that
 * falls back to toFixed() gives every non-US user US grouping and symbol
 * placement — "€1,234.56" where they expect "1 234,56 €". So the parts are
 * derived once on the JS thread and the worklet reassembles them per frame.
 */
export interface CurrencyParts {
  prefix: string;
  suffix: string;
  group: string;
  decimal: string;
  decimals: number;
}

/**
 * Derive the parts by formatting probe values and reading them back.
 *
 * Two probes, because one cannot tell a decimal separator from a grouping
 * one. JPY formats 1234.56 as "￥1,235" — that comma is grouping, and a
 * single-probe reading calls it the decimal point and reports three decimal
 * places. So: `1` reveals how many decimals the currency has, and `1111`
 * reveals the grouping separator once the decimal one is already known.
 */
const DIGITS = /[\d\u0660-\u0669\u06F0-\u06F9]/;

function numericBody(formatted: string): { body: string; start: number } {
  let first = -1;
  let last = -1;
  for (let i = 0; i < formatted.length; i++) {
    if (DIGITS.test(formatted[i]!)) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1) return { body: '', start: 0 };
  return { body: formatted.slice(first, last + 1), start: first };
}

export function currencyParts(format: (n: number) => string): CurrencyParts {
  const onePrinted = format(1);
  const one = numericBody(onePrinted);
  if (!one.body) return { prefix: '', suffix: '', group: ',', decimal: '.', decimals: 2 };

  // Everything non-digit inside "1.00" / "1,00" / "1" is the decimal separator.
  const oneSeps = one.body.split('').filter((ch) => !DIGITS.test(ch));
  const decimal = oneSeps.length > 0 ? oneSeps[0]! : '.';
  const decimals = oneSeps.length > 0
    ? one.body.slice(one.body.indexOf(decimal) + decimal.length).length
    : 0;

  // With the decimal separator known, anything else in 1111 is grouping.
  const many = numericBody(format(1111));
  const group = many.body
    .split('')
    .find((ch) => !DIGITS.test(ch) && ch !== decimal) ?? '';

  return {
    prefix: onePrinted.slice(0, one.start),
    suffix: onePrinted.slice(one.start + one.body.length),
    group,
    decimal,
    decimals,
  };
}

/**
 * Rebuild a formatted amount from its parts. Safe to call in a worklet:
 * string and arithmetic only, no Intl, no allocation-heavy APIs.
 */
export function formatWithParts(value: number, parts: CurrencyParts): string {
  'worklet';
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(parts.decimals);
  const [whole, fraction] = fixed.split('.');

  let grouped = whole ?? '0';
  if (parts.group) {
    grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, parts.group);
  }

  const body = fraction ? `${grouped}${parts.decimal}${fraction}` : grouped;
  return `${negative ? '-' : ''}${parts.prefix}${body}${parts.suffix}`;
}

/**
 * The pieces an amount is drawn from, per DESIGN-PROMPT.md §3.
 *
 * The number rules are specific: decimals stay the same size but drop to 55%
 * opacity, the currency symbol is 65% size and raised, and every transaction
 * amount carries an explicit sign rather than relying on colour. Rendering
 * that means splitting a formatted string into parts and styling each one, so
 * the split lives here — pure, and tested — rather than inside the component.
 *
 * Grouping and the decimal separator come from `parts`, which was derived from
 * the user's own locale, so this never hard-codes "," and ".".
 */
export interface AmountPieces {
  /** "−", "+", or "" — §3 requires a sign on signed amounts, never colour alone. */
  sign: string;
  /** Leading currency symbol, "" when the locale puts it after the number. */
  prefix: string;
  /** Grouped integer part. */
  whole: string;
  /** Separator plus fraction digits, "" for a zero-decimal currency like JPY. */
  fraction: string;
  /** Trailing currency symbol, "" when the locale puts it before the number. */
  suffix: string;
}

/**
 * How far to shrink an amount so it stays on one line.
 *
 * §7 requires the balance card to "survive a three-character code and seven
 * significant digits". It did not: `Amount` lays its pieces out in a row at a
 * fixed size, and a large figure in a three-character currency simply ran off
 * the edge — `−CN¥77,777,884.00` rendered with the decimals clipped by the
 * card's own `overflow: hidden`, so the number silently lied about itself.
 *
 * Character count rather than measured width, because the pieces are separate
 * Text nodes and measuring them means a layout pass and a re-render per frame
 * of the count-up. Plus Jakarta's figures are tabular here, so every digit is
 * one width and counting them is exact for the part that varies.
 *
 * Floored at 0.55: past that the figure is too small to be the thing the eye
 * lands on, and a card that needs more than that is a card whose budget was
 * wrong to begin with.
 */
export function amountScale(glyphs: number, budget: number): number {
  if (budget <= 0 || glyphs <= budget) return 1;
  return Math.max(0.55, budget / glyphs);
}

export function splitAmount(
  value: number,
  parts: CurrencyParts,
  signed: boolean
): AmountPieces {
  const fixed = Math.abs(value).toFixed(parts.decimals);
  const [wholeRaw, fractionDigits] = fixed.split('.');
  const whole = parts.group
    ? (wholeRaw ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, parts.group)
    : (wholeRaw ?? '0');

  // A minus sign, not a hyphen: U+2212 aligns with the digits in a tabular
  // face, where a hyphen sits short and high.
  const sign = value < 0 ? '\u2212' : signed ? '+' : '';

  return {
    sign,
    prefix: parts.prefix.trim(),
    whole,
    fraction: fractionDigits ? `${parts.decimal}${fractionDigits}` : '',
    suffix: parts.suffix.trim(),
  };
}

// ── Physical motion (apple-design §4, §6, §9) ───────────────────────────────

// The springs that lived here (SPRING_MOVE 400 ms, SPRING_SHEET and
// SPRING_FLICK with overshoot) are retired: the identity moves everything on
// timed, non-overshooting curves under 300 ms (lib/identity/motion.ts).

/**
 * Where a flick would come to rest.
 *
 * Snapping to whatever is nearest the *release point* throws the velocity
 * away, and a hard flick then travels no further than a slow drag — the one
 * thing that makes a gesture feel like it threw something. So project the
 * resting position first, then choose the snap target nearest the projection.
 *
 * This is the exponential-decay form from the talk's sample code, not the
 * textbook `v²/2a`: the two disagree, and this is the one iOS ships.
 *
 * @param velocity px/s at release.
 * @param decelerationRate 0.998 for normal scroll feel, 0.99 for snappier.
 * @returns the distance still to travel, in px, signed like the velocity.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  'worklet';
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary.
 *
 * A hard stop at the end of a drag reads as frozen — the user cannot tell a
 * limit from a bug. Resistance that grows the further they pull reads as
 * "responsive, but there is nothing more here", which is the same thing a
 * real object would say.
 *
 * @param overshoot how far past the boundary the finger has travelled.
 * @param dimension the size of the axis, which sets how fast resistance grows.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
