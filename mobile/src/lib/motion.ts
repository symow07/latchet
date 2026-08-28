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
 * How long a number should take to count.
 *
 * Fixed durations make small numbers feel sluggish and large ones feel rushed,
 * so it scales with magnitude and then stops — past about a second the user is
 * waiting on an animation rather than reading a figure.
 */
export function countDuration(target: number): number {
  const magnitude = Math.abs(target);
  if (magnitude === 0) return 0;
  return Math.min(420 + Math.log10(magnitude + 1) * 240, 1100);
}

/** Press feedback. Enough to feel, not enough to notice. */
export const PRESS_SCALE = 0.97;

export const SPRING = { damping: 18, stiffness: 220, mass: 0.7 } as const;

/**
 * The hero's slow breath: a shadow that swells and settles, ~6s a cycle.
 *
 * The first pass ran 0.72 -> 1.0, which measured as a peak difference of 4/255
 * against the dark background — present in the pixels, invisible to a person.
 * A range wide enough to notice is the entire point of an ambient effect; one
 * you cannot see is just battery.
 */
export const BREATH_MS = 5800;
export const BREATH_MIN = 0.45;
export const BREATH_MAX = 1;

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
