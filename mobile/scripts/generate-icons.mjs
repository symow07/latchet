/**
 * Regenerate src/lib/icon-paths.ts from Iconify.
 *
 *   node scripts/generate-icons.mjs
 *
 * The app's icons are baked into the repo as SVG path data rather than pulled
 * from an icon package. Three reasons, in order of how much each matters:
 *
 *   1. No runtime fetch and no font file — the paths ship in the bundle.
 *   2. No new dependency. react-native-svg is already here, so the icons cost
 *      nothing to install and nothing to rebuild natively.
 *   3. Any icon from any Iconify set can be used. The set below is Hugeicons,
 *      but a single icon can be sourced from elsewhere by changing one line —
 *      which matters, because no set has every icon an app actually means.
 *
 * Generated output is committed. Run this only to change or add an icon.
 */
import { writeFileSync } from 'node:fs';

/**
 * app name → `prefix:icon-name` in Iconify.
 *
 * **Hugeicons, stroke rounded** (MIT). The design identity's icon reference is
 * this family: one 1.5 stroke on a 24 grid, round caps and joins, soft
 * squircle containers, a single interior detail (the house's door, the
 * inbox's tray, the calendar's dot grid). DESIGN-IDENTITY.md §Glyphs.
 *
 * Every glyph is an outline. The previous set was Solar Bold Duotone, and
 * nothing in the identity is filled or two-tone: the only filled marks a
 * Hugeicons glyph carries are dots, which the reference uses as texture.
 *
 * Check is the circled check, a mark that stands on its own; Tick is the bare
 * tick, for inside a checkbox, a filled disc or a swatch that already draws
 * the container. Putting Check there drew two circles.
 *
 * A few are interpretations rather than translations: HeartPulse (the health
 * score) → `heart-check`, Wrench (business tools) → `wrench-01`. Delete (the
 * keypad's backspace) has no Hugeicons equivalent at all and is drawn here, in
 * DRAWN below. The category marks (Airplane, Car, Dumbbell, Laptop, MoneyIn,
 * Package, ShoppingBag, Tag, Utensils) give each built-in category, personal
 * and business, a glyph, since the identity marks a category by its glyph on a
 * tile rather than by a colour.
 */
const FILL = {
  Activity: 'hugeicons:analytics-01',
  Airplane: 'hugeicons:airplane-01',
  AlertCircle: 'hugeicons:alert-circle',
  AlertTriangle: 'hugeicons:alert-02',
  ArrowDownLeft: 'hugeicons:arrow-down-left-01',
  ArrowUpRight: 'hugeicons:arrow-up-right-01',
  Award: 'hugeicons:award-01',
  Bell: 'hugeicons:notification-01',
  Briefcase: 'hugeicons:briefcase-01',
  Building2: 'hugeicons:building-03',
  Calendar: 'hugeicons:calendar-03',
  Camera: 'hugeicons:camera-01',
  Car: 'hugeicons:car-01',
  Check: 'hugeicons:checkmark-circle-02',
  CheckCheck: 'hugeicons:tick-double-02',
  ChevronDown: 'hugeicons:arrow-down-01',
  ChevronLeft: 'hugeicons:arrow-left-01',
  ChevronRight: 'hugeicons:arrow-right-01',
  ChevronUp: 'hugeicons:arrow-up-01',
  ClipboardCheck: 'hugeicons:task-done-01',
  Clock: 'hugeicons:clock-01',
  Cloud: 'hugeicons:cloud',
  Copy: 'hugeicons:copy-01',
  CreditCard: 'hugeicons:credit-card',
  Crown: 'hugeicons:crown',
  Delete: 'drawn:backspace',
  Download: 'hugeicons:download-01',
  Dumbbell: 'hugeicons:dumbbell-01',
  Edit3: 'hugeicons:pencil-edit-02',
  ExternalLink: 'hugeicons:link-square-02',
  Eye: 'hugeicons:view',
  EyeOff: 'hugeicons:view-off-slash',
  FileText: 'hugeicons:file-02',
  Fingerprint: 'hugeicons:finger-print',
  Flame: 'hugeicons:fire',
  Globe: 'hugeicons:globe-02',
  HeartPulse: 'hugeicons:heart-check',
  HelpCircle: 'hugeicons:help-circle',
  Home: 'hugeicons:home-08',
  ImageIcon: 'hugeicons:image-01',
  Inbox: 'hugeicons:inbox',
  KeyRound: 'hugeicons:key-01',
  Laptop: 'hugeicons:laptop',
  Lightbulb: 'hugeicons:bulb',
  Lock: 'hugeicons:square-lock-02',
  LogOut: 'hugeicons:logout-03',
  Mail: 'hugeicons:mail-01',
  MessageCircle: 'hugeicons:bubble-chat',
  Mic: 'hugeicons:mic-01',
  MoneyIn: 'hugeicons:money-receive-square',
  Moon: 'hugeicons:moon-02',
  MoreHorizontal: 'hugeicons:more-horizontal',
  Package: 'hugeicons:package',
  PartyPopper: 'hugeicons:party',
  PieChart: 'hugeicons:pie-chart',
  PiggyBank: 'hugeicons:piggy-bank',
  Play: 'hugeicons:play',
  Plus: 'hugeicons:add-01',
  PlusSquare: 'hugeicons:add-square',
  Receipt: 'hugeicons:invoice-01',
  RefreshCw: 'hugeicons:refresh',
  Repeat: 'hugeicons:repeat',
  RotateCcw: 'hugeicons:arrow-reload-horizontal',
  Search: 'hugeicons:search-01',
  Send: 'hugeicons:sent',
  Shield: 'hugeicons:shield-01',
  ShieldCheck: 'hugeicons:security-check',
  ShoppingBag: 'hugeicons:shopping-bag-01',
  SlidersHorizontal: 'hugeicons:filter-horizontal',
  Smartphone: 'hugeicons:smart-phone-01',
  Sparkles: 'hugeicons:sparkles',
  Sun: 'hugeicons:sun-03',
  Tag: 'hugeicons:tag-01',
  Target: 'hugeicons:target-02',
  Tick: 'hugeicons:tick-02',
  Trash2: 'hugeicons:delete-02',
  TrendingUp: 'hugeicons:chart-increase',
  Upload: 'hugeicons:upload-01',
  User: 'hugeicons:user',
  User2: 'hugeicons:user-circle',
  UserPlus: 'hugeicons:user-add-01',
  Users: 'hugeicons:user-multiple',
  Utensils: 'hugeicons:restaurant-02',
  Wallet: 'hugeicons:wallet-01',
  Wrench: 'hugeicons:wrench-01',
  X: 'hugeicons:cancel-01',
  XCircle: 'hugeicons:cancel-circle',
  Zap: 'hugeicons:flash',
};

/**
 * The tab bars' set.
 *
 * The bar used to mark the active destination by filling its glyph, so each
 * entry had a solid and an outline twin. The identity never fills a glyph:
 * the active tab is the same outline in the tint, on a soft capsule. Both maps
 * stay so TabIcons keeps its shape, and they point at the same art.
 */
const BAR_FILL = {
  Home: 'hugeicons:home-08',
  Records: 'hugeicons:invoice-01',
  Add: 'hugeicons:add-square',
  Insights: 'hugeicons:chart-histogram',
  Gear: 'hugeicons:settings-02',
  Advisor: 'hugeicons:bubble-chat',
  Money: 'hugeicons:wallet-01',
};
const BAR_LINE = BAR_FILL;

/**
 * Glyphs the reference family does not have, drawn in its grammar: a 24 grid,
 * one 1.5 stroke, round caps and joins, soft corners, one interior detail.
 *
 * Hugeicons' free set has no backspace. The nearest names are a bin with a
 * return arrow (`delete-put-back`), which on the keypad read as "delete this
 * transaction", and `text-clear`, a struck-through T. This is the shape every
 * keyboard uses: a tag pointing left, with a cross in it.
 */
const DRAWN = {
  'drawn:backspace':
    '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">' +
    '<path d="M9.66 5h8.09A3.25 3.25 0 0 1 21 8.25v7.5A3.25 3.25 0 0 1 17.75 19H9.66a3 3 0 0 1-2.2-.96l-3.98-4.3a2.5 2.5 0 0 1 0-3.48l3.98-4.3A3 3 0 0 1 9.66 5Z"/>' +
    '<path d="M11.75 9.5l5 5"/><path d="M16.75 9.5l-5 5"/></g>',
};

const specs = [FILL, BAR_FILL, BAR_LINE].flatMap((m) => Object.values(m));
const byPrefix = {};
for (const spec of new Set(specs)) {
  const [p, n] = spec.split(':');
  (byPrefix[p] ??= new Set()).add(n);
}

const bodies = { ...DRAWN };
for (const [prefix, set] of Object.entries(byPrefix)) {
  if (prefix === 'drawn') continue;
  const url = `https://api.iconify.design/${prefix}.json?icons=${[...set].join(',')}`;
  // Iconify rejects the default Node user agent with a 403, and the failure is
  // silent from here — the body parses as JSON with no `icons` key, so without
  // this header the generator fails much later with an unrelated-looking error.
  const res = await fetch(url, { headers: { 'User-Agent': 'budget-icon-generator' } });
  if (!res.ok) throw new Error(`${prefix}: HTTP ${res.status} from Iconify`);
  const json = await res.json();
  // An icon may come back as an alias pointing at another icon's body.
  for (const [n, v] of Object.entries(json.icons ?? {})) bodies[`${prefix}:${n}`] = v.body;
  for (const [n, v] of Object.entries(json.aliases ?? {})) {
    bodies[`${prefix}:${n}`] = bodies[`${prefix}:${v.parent}`] ?? json.icons?.[v.parent]?.body;
  }
  const missing = [...set].filter((n) => !bodies[`${prefix}:${n}`]);
  if (missing.length) throw new Error(`${prefix}: no body for ${missing.join(', ')}`);
}

/**
 * Pull `<path>` elements out of an Iconify body, keeping how each one is painted.
 *
 * Three things have to survive, and each was learned by losing it:
 *
 *   `d`         obviously.
 *   stroke      the outline variants are `fill="none"` with a stroke width.
 *               Reading only `d` and filling everything turns an outline icon
 *               into a handful of unrecognisable blobs.
 *   `opacity`   a duotone icon *is* its opacities — the second tone is one
 *               path at 0.5. Dropping it renders every layer at full strength,
 *               which collapses the icon into a solid silhouette. That is why
 *               duotone looked flat and pointless the first time it was tried:
 *               it was never actually duotone.
 */
/**
 * The faintest a duotone's second tone may go.
 *
 * Solar ships it at 0.5, which is tuned for the sizes an icon set is *shown* at
 * rather than the 20–26px it is used at here. Measured against the surfaces
 * these actually sit on — the tab bar's capsule, the tinted icon tiles, a white
 * card — 0.5 puts the second tone between 2.2:1 and 2.5:1, under the 3:1 that a
 * shape carrying meaning owes. The second tone is not decoration: strip it from
 * `user` and you have an unlabelled circle.
 *
 * 0.68 is the tightest floor that clears 3:1 in every one of those cases;
 * rounded to 0.7. The icons still read as two-tone — just not as two tones one
 * of which has vanished.
 */
const MIN_TONE = 0.7;

/** An ellipse as an arc pair, so every glyph is one shape type downstream. */
function ellipseToPath(cx, cy, rx, ry) {
  return (
    `M${cx - rx},${cy}` +
    `a${rx},${ry} 0 1,0 ${rx * 2},0` +
    `a${rx},${ry} 0 1,0 ${-rx * 2},0Z`
  );
}

/** Clamp a source opacity to something still legible at icon sizes. */
function tone(raw) {
  if (raw === undefined) return undefined;
  const v = Number(raw);
  return v >= 1 ? undefined : Math.max(MIN_TONE, v);
}

function paths(body, spec) {
  // Paint attributes are commonly set once on the wrapping <g> rather than on
  // each shape — Solar's outline variants put `fill="none" stroke="currentColor"
  // stroke-width="1.5"` there and leave the paths bare. Reading only the shape's
  // own attributes made every outline icon a filled silhouette, and turned the
  // plus (two zero-area lines) into nothing at all.
  const g = body.match(/<g\b([^>]*)>/)?.[1] ?? '';
  const inherited = (n) => g.match(new RegExp(`\\s${n}="([^"]+)"`))?.[1];

  const out = [];
  for (const tag of body.match(/<(?:path|circle|ellipse)\b[^>]*\/?>/g) ?? []) {
    const own = (n) => tag.match(new RegExp(`\\s${n}="([^"]+)"`))?.[1];
    const paint = (n) => own(n) ?? inherited(n);

    let d;
    if (tag.startsWith('<path')) {
      d = own('d');
    } else {
      // Circles and ellipses become arcs, so the generated data stays a single
      // shape type and the runtime stays one <Path> per entry.
      const num = (n) => Number(own(n) ?? 0);
      const r = num('r');
      const rx = tag.startsWith('<circle') ? r : num('rx');
      const ry = tag.startsWith('<circle') ? r : num('ry');
      if (!rx || !ry) continue;
      d = ellipseToPath(num('cx'), num('cy'), rx, ry);
    }
    if (!d) continue;

    // Opacity is never inherited here on purpose: it is what distinguishes a
    // duotone's second tone from its first, and both live under the same <g>.
    const opacity = tone(own('fill-opacity') ?? own('opacity'));

    if (paint('fill') === 'none' && paint('stroke')) {
      out.push({
        d,
        stroke: Number(paint('stroke-width') ?? 1.5),
        cap: paint('stroke-linecap'),
        join: paint('stroke-linejoin'),
        opacity,
      });
    } else {
      out.push({ d, fillRule: own('fill-rule'), opacity });
    }
  }
  if (!out.length) throw new Error(`${spec}: no path data`);
  return out;
}

function entry(name, spec) {
  const body = bodies[spec];
  if (!body) throw new Error(`no body fetched for ${name} -> ${spec}`);
  const lit = (p) => {
    const esc = p.d.replace(/'/g, "\\'");
    const parts = [`d: '${esc}'`];
    if (p.stroke) {
      parts.push(`stroke: ${p.stroke}`);
      if (p.cap) parts.push(`cap: '${p.cap}' as const`);
      if (p.join) parts.push(`join: '${p.join}' as const`);
    } else if (p.fillRule) {
      parts.push(`fillRule: '${p.fillRule}' as const`);
    }
    if (p.opacity !== undefined) parts.push(`opacity: ${p.opacity}`);
    return `      { ${parts.join(', ')} }`;
  };
  const ps = paths(body, spec).map(lit).join(',\n');
  return `  ${name}: {\n    source: '${spec}',\n    paths: [\n${ps},\n    ],\n  },`;
}

writeFileSync(
  new URL('../src/lib/icon-paths.ts', import.meta.url),
  `/**
 * The app's icon artwork, as SVG path data.
 *
 * GENERATED by scripts/generate-icons.mjs — edit that, not this.
 *
 * Baked in rather than imported from an icon package: no runtime fetch, no font
 * file, no new dependency (react-native-svg is already here), and any icon from
 * any Iconify set is available by changing one line in the generator. \`source\`
 * records where each glyph came from so a swap is traceable.
 *
 * The set is **Hugeicons stroke rounded**: single-weight outlines on a 24 grid,
 * round caps and joins, after the design identity's icon reference.
 */

export interface IconPath {
  d: string;
  fillRule?: 'evenodd' | 'nonzero';
  /** Present when this path is stroked rather than filled — its stroke width. */
  stroke?: number;
  cap?: 'round' | 'butt' | 'square';
  join?: 'round' | 'miter' | 'bevel';
  /**
   * Below 1 on the secondary layer of a duotone icon.
   *
   * This is the whole of the duotone effect. Drop it and every layer renders at
   * full strength, which collapses the glyph into a solid silhouette.
   */
  opacity?: number;
}

export interface IconArt {
  /** \`prefix:name\` in Iconify, for regenerating or swapping this one glyph. */
  source: string;
  paths: readonly IconPath[];
}

/** The app's glyphs, all single-weight outlines. */
export const ICON_PATHS = {
${Object.entries(FILL).map(([n, s]) => entry(n, s)).join('\n')}
} as const satisfies Record<string, IconArt>;

/** The tab bar's glyphs for the active destination (the same outlines). */
export const ICON_PATHS_BAR = {
${Object.entries(BAR_FILL).map(([n, s]) => entry(n, s)).join('\n')}
} as const satisfies Record<string, IconArt>;

/** The tab bar's glyphs for every other destination. */
export const ICON_PATHS_LINE = {
${Object.entries(BAR_LINE).map(([n, s]) => entry(n, s)).join('\n')}
} as const satisfies Record<string, IconArt>;

export type IconName = keyof typeof ICON_PATHS;
`
);
console.log(`generated ${Object.keys(FILL).length} app icons + ${Object.keys(BAR_FILL).length} bar pairs`);
