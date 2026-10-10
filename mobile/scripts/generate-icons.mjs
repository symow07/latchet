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
 *   3. Any icon from any Iconify set can be used. The set below is Mingcute,
 *      but a single icon can be sourced from elsewhere by changing one line —
 *      which matters, because no set has every icon an app actually means.
 *
 * Generated output is committed. Run this only to change or add an icon.
 */
import { writeFileSync } from 'node:fs';

/**
 * app name → `prefix:icon-name` in Iconify.
 *
 * **Solar Bold Duotone.** Chosen after the client pointed at Iconly, which is
 * commercial and not redistributable — Solar is the closest freely-licensed set
 * to it (CC BY 4.0), and shares the rounded, soft, slightly playful register.
 *
 * Duotone only works if the generator keeps each path's `opacity`: the second
 * tone *is* one path at 0.5, and dropping it renders every layer at full
 * strength, which collapses the glyph into a solid silhouette. That is exactly
 * what happened the first time duotone was tried and dismissed as flat — it was
 * never actually duotone. See `paths` below.
 *
 * **Utility marks are `-linear`, not duotone.** A chevron, a tick, a plus or a
 * close is a mark rather than a picture — there is no second tone for it to
 * have. As duotone they come out as solid filled triangles and blobs, which in
 * a list row reads as something being wrong rather than as emphasis.
 *
 * The quick-action tiles are the exception, and `PlusSquare` is why — see the
 * comment on it. The rule is about *context*, not about the glyph: the same
 * plus that should stay a hairline mark at the end of a row has to hold its own
 * as a picture when it is the only thing inside a 56px disc.
 *
 * A few are interpretations rather than translations, because Solar has no
 * equivalent: PiggyBank → `safe-2`, Fingerprint → `face-scan-circle`,
 * Wrench → `toolbox` (which suits "Business Tools" better than a wrench did
 * anyway). Each keeps the *meaning* the call site depends on.
 */
const FILL = {
  Activity: 'solar:chart-square-bold-duotone',
  AlertCircle: 'solar:danger-circle-bold-duotone',
  AlertTriangle: 'solar:danger-triangle-bold-duotone',
  ArrowDownLeft: 'solar:round-arrow-left-down-linear',
  ArrowUpRight: 'solar:round-arrow-right-up-linear',
  Award: 'solar:cup-star-bold-duotone',
  Bell: 'solar:bell-bold-duotone',
  Briefcase: 'solar:case-bold-duotone',
  Building2: 'solar:buildings-2-bold-duotone',
  Calendar: 'solar:calendar-bold-duotone',
  Camera: 'solar:camera-bold-duotone',
  Check: 'solar:check-circle-linear',
  CheckCheck: 'solar:check-read-linear',
  ChevronDown: 'solar:alt-arrow-down-linear',
  ChevronLeft: 'solar:alt-arrow-left-linear',
  ChevronRight: 'solar:alt-arrow-right-linear',
  ChevronUp: 'solar:alt-arrow-up-linear',
  ClipboardCheck: 'solar:clipboard-check-bold-duotone',
  Clock: 'solar:clock-circle-bold-duotone',
  Cloud: 'solar:cloud-bold-duotone',
  Copy: 'solar:copy-bold-duotone',
  CreditCard: 'solar:card-bold-duotone',
  Crown: 'solar:crown-bold-duotone',
  Delete: 'solar:backspace-linear',
  Download: 'solar:download-minimalistic-bold-duotone',
  Edit3: 'solar:pen-new-square-bold-duotone',
  ExternalLink: 'solar:square-arrow-right-up-bold-duotone',
  Eye: 'solar:eye-bold-duotone',
  EyeOff: 'solar:eye-closed-bold-duotone',
  FileText: 'solar:document-text-bold-duotone',
  Fingerprint: 'solar:face-scan-circle-bold-duotone',
  Flame: 'solar:fire-bold-duotone',
  Globe: 'solar:globe-bold-duotone',
  HeartPulse: 'solar:heart-pulse-bold-duotone',
  HelpCircle: 'solar:question-circle-bold-duotone',
  Home: 'solar:home-angle-bold-duotone',
  ImageIcon: 'solar:gallery-bold-duotone',
  Inbox: 'solar:inbox-bold-duotone',
  KeyRound: 'solar:key-bold-duotone',
  Lightbulb: 'solar:lightbulb-bold-duotone',
  Lock: 'solar:lock-bold-duotone',
  LogOut: 'solar:logout-2-bold-duotone',
  Mail: 'solar:letter-bold-duotone',
  MessageCircle: 'solar:chat-round-bold-duotone',
  Mic: 'solar:microphone-bold-duotone',
  Moon: 'solar:moon-bold-duotone',
  MoreHorizontal: 'solar:menu-dots-linear',
  PartyPopper: 'solar:confetti-bold-duotone',
  PieChart: 'solar:pie-chart-2-bold-duotone',
  PiggyBank: 'solar:safe-2-bold-duotone',
  Play: 'solar:play-bold-duotone',
  Plus: 'solar:add-linear',
  // The one exception to the rule above, and it is a slot rather than a whim.
  // A quick-action tile is a *picture* slot: one glyph alone in a 56px disc,
  // beside a camera and a pie chart drawn as solid duotone shapes. A 1.5pt
  // cross next to those does not read as restraint, it reads as a different
  // icon set — and Solar has no heavier plain plus (`add-bold` is the same
  // 1.5pt bar drawn as a fill). The contained form is the way to give the mark
  // a picture's weight without redrawing it.
  PlusSquare: 'solar:add-square-bold-duotone',
  Receipt: 'solar:bill-bold-duotone',
  RefreshCw: 'solar:refresh-bold-duotone',
  Repeat: 'solar:repeat-bold-duotone',
  RotateCcw: 'solar:restart-bold-duotone',
  Search: 'solar:magnifier-linear',
  Send: 'solar:plane-bold-duotone',
  Shield: 'solar:shield-bold-duotone',
  ShieldCheck: 'solar:shield-check-bold-duotone',
  SlidersHorizontal: 'solar:tuning-2-bold-duotone',
  Smartphone: 'solar:smartphone-bold-duotone',
  Sparkles: 'solar:stars-bold-duotone',
  Sun: 'solar:sun-bold-duotone',
  Target: 'solar:target-bold-duotone',
  Trash2: 'solar:trash-bin-trash-bold-duotone',
  TrendingUp: 'solar:graph-up-bold-duotone',
  Upload: 'solar:upload-minimalistic-bold-duotone',
  User: 'solar:user-bold-duotone',
  User2: 'solar:user-bold-duotone',
  UserPlus: 'solar:user-plus-rounded-bold-duotone',
  Users: 'solar:users-group-rounded-bold-duotone',
  Wallet: 'solar:wallet-bold-duotone',
  Wrench: 'solar:toolbox-bold-duotone',
  X: 'solar:close-linear',
  XCircle: 'solar:close-circle-bold-duotone',
  Zap: 'solar:bolt-bold-duotone',
};

/**
 * The tab bars' own set, in both forms.
 *
 * A bar marks the active destination by filling its glyph, so each of these
 * needs a solid *and* an outline. Only bar icons do, which is why the other 76
 * are generated solid-only.
 *
 * These are chosen to be read **without a label**, since the bar has none. That
 * rules out a few that were fine underneath a word and are not on their own:
 *
 *   Insights   was `sparkles` — which says "AI", not "charts". A bar chart says
 *              what the page contains.
 *   Advisor    is `chat-1-ai`, a speech bubble carrying AI marks. Sparkles alone
 *              meant nothing specific; this says "ask something and get an
 *              answer", which is the page.
 *   Settings   was `settings-6`, a row of sliders. A gear is the one icon
 *              every user already knows means settings.
 *   Records    is a receipt. Both the personal Activity list and the business
 *              Expenses list are lists of money spent, so they share it.
 */
const BAR_FILL = {
  Home: 'solar:home-angle-bold-duotone',
  Records: 'solar:bill-bold-duotone',
  Add: 'solar:add-bold-duotone',
  Insights: 'solar:chart-2-bold-duotone',
  Gear: 'solar:settings-bold-duotone',
  Advisor: 'solar:chat-round-dots-bold-duotone',
  Money: 'solar:wallet-bold-duotone',
};
const BAR_LINE = {
  Home: 'solar:home-angle-linear',
  Records: 'solar:bill-linear',
  Add: 'solar:add-linear',
  Insights: 'solar:chart-2-linear',
  Gear: 'solar:settings-linear',
  Advisor: 'solar:chat-round-dots-linear',
  Money: 'solar:wallet-linear',
};

const specs = [FILL, BAR_FILL, BAR_LINE].flatMap((m) => Object.values(m));
const byPrefix = {};
for (const spec of new Set(specs)) {
  const [p, n] = spec.split(':');
  (byPrefix[p] ??= new Set()).add(n);
}

const bodies = {};
for (const [prefix, set] of Object.entries(byPrefix)) {
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
 * The set is **Mingcute Fill** — big, round, solid shapes. It replaced a
 * hairline outline set that made the app read as technical rather than
 * friendly, and then a filled-but-tight set that was better and still not it.
 * Duotone was tried and rejected: two-tone glyphs wash out to unreadable at
 * 22px on the saturated tab bar, which is where the icons matter most.
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

/** Solid glyphs — the default everywhere in the app. */
export const ICON_PATHS = {
${Object.entries(FILL).map(([n, s]) => entry(n, s)).join('\n')}
} as const satisfies Record<string, IconArt>;

/** The tab bars' solid glyphs — the active destination. */
export const ICON_PATHS_BAR = {
${Object.entries(BAR_FILL).map(([n, s]) => entry(n, s)).join('\n')}
} as const satisfies Record<string, IconArt>;

/** Their outline twins — every other destination. */
export const ICON_PATHS_LINE = {
${Object.entries(BAR_LINE).map(([n, s]) => entry(n, s)).join('\n')}
} as const satisfies Record<string, IconArt>;

export type IconName = keyof typeof ICON_PATHS;
`
);
console.log(`generated ${Object.keys(FILL).length} app icons + ${Object.keys(BAR_FILL).length} bar pairs`);
