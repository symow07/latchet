/**
 * Build the public website's generated module, src/site/generated.ts.
 *
 *   bun scripts/build-site.ts           # write it
 *   bun scripts/build-site.ts --check   # exit 1 if it is out of date
 *
 * The website (/, /privacy, /terms) is served by this backend, and Railway
 * deploys only this directory, so everything the pages need from outside it is
 * baked into one committed module:
 *
 *   - PRIVACY.md and TERMS.md at the repository root, rendered to HTML. They stay
 *     the single source: the policy Google and App Review read is the one in the
 *     repository, word for word.
 *   - The identity's palette, from mobile/src/lib/identity/tokens.ts, so the site
 *     wears exactly the app's colours.
 *   - The few glyphs the home page shows, from mobile/src/lib/icon-paths.ts (the
 *     app's Hugeicons set), so no icon is drawn twice.
 *
 * src/site/site.test.ts rebuilds the module in memory and fails when it differs
 * from the committed one, so editing a source without re-running this is caught.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const ROOT = join(import.meta.dir, "..", "..");
export const GENERATED_PATH = join(import.meta.dir, "..", "src", "site", "generated.ts");

/** The palette roles the site's stylesheet uses. */
const PALETTE_KEYS = [
  "ground", "surface", "sunk", "ink", "inkSoft", "inkDim", "hairline",
  "espresso", "onEspresso", "onEspressoDim", "tint", "tintSoft",
  "silver", "silverHi", "silverEdge", "silverSoft", "silverInk", "shadow",
] as const;

/** Home-page glyphs: the name the page uses, and the app's icon it is. */
const GLYPHS = {
  wallet: "Wallet",
  repeat: "Repeat",
  bell: "Bell",
  receipt: "Receipt",
  card: "CreditCard",
  phone: "Smartphone",
  mail: "Mail",
  shield: "ShieldCheck",
  trash: "Trash2",
} as const;

export interface LegalPage {
  title: string;
  updated: string;
  html: string;
}

/** A heading's anchor: lowercase words joined by hyphens, as GitHub makes them. */
export function slug(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Render a policy document. Its `# Title` and `_Last updated: …_` line are
 * lifted out for the page header; HTML comments (internal TODOs) never reach
 * the page; headings get anchors so a section can be linked; tables are wrapped
 * so they scroll on a phone instead of widening the page.
 */
export function renderLegal(markdown: string): LegalPage {
  const source = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const title = source.match(/^# (.+)$/m)?.[1]?.trim();
  const updated = source.match(/^_Last updated: (.+)_$/m)?.[1]?.trim();
  if (!title || !updated) throw new Error("a policy needs a '# Title' and a '_Last updated: …_' line");
  const body = source.replace(/^# .+$/m, "").replace(/^_Last updated: .+_$/m, "");

  const seen = new Map<string, number>();
  const html = (marked.parse(body, { gfm: true, async: false }) as string)
    .replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
      const base = slug(inner);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const id = n === 0 ? base : `${base}-${n}`;
      return `<h${level} id="${id}">${inner}</h${level}>`;
    })
    .replace(/<table>[\s\S]*?<\/table>/g, (table) => `<div class="table-wrap">${labelCells(table)}</div>`)
    .trim();
  return { title: title.replace(/^Latchet — /, ""), updated, html };
}

/**
 * Give every body cell its column's heading as `data-label`, so on a phone the
 * stylesheet can lay each row out as a small card ("Source: You, at sign-up")
 * instead of a table scrolled sideways.
 */
function labelCells(table: string): string {
  const labels = [...(table.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map(([, text]) => (text ?? "").replace(/<[^>]+>/g, "").replace(/"/g, "&quot;").trim());
  return table.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, cells: string) => {
    if (!cells.includes("<td")) return row;
    let i = 0;
    return `<tr>${cells.replace(/<td>/g, () => `<td data-label="${labels[i++] ?? ""}">`)}</tr>`;
  });
}

interface IconPathSpec {
  d: string;
  fillRule?: string;
  stroke?: number;
  cap?: string;
  join?: string;
  opacity?: number;
}

/** One of the app's glyphs as inline SVG, drawn in the current text colour. */
function glyphSvg(paths: readonly IconPathSpec[]): string {
  const shapes = paths.map((p) => {
    const attrs = [`d="${p.d}"`];
    if (p.stroke) {
      attrs.push('fill="none"', 'stroke="currentColor"', `stroke-width="${p.stroke}"`);
      if (p.cap) attrs.push(`stroke-linecap="${p.cap}"`);
      if (p.join) attrs.push(`stroke-linejoin="${p.join}"`);
    } else {
      attrs.push('fill="currentColor"');
      if (p.fillRule) attrs.push(`fill-rule="${p.fillRule}"`);
    }
    if (p.opacity !== undefined) attrs.push(`opacity="${p.opacity}"`);
    return `<path ${attrs.join(" ")}/>`;
  });
  return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${shapes.join("")}</svg>`;
}

/** The whole generated module, as text. Pure apart from reading the sources. */
export async function buildSite(): Promise<string> {
  const privacy = renderLegal(readFileSync(join(ROOT, "PRIVACY.md"), "utf8"));
  const terms = renderLegal(readFileSync(join(ROOT, "TERMS.md"), "utf8"));

  // Non-literal paths: the backend's typecheck should not walk into the app.
  const tokensPath = join(ROOT, "mobile", "src", "lib", "identity", "tokens.ts");
  const iconsPath = join(ROOT, "mobile", "src", "lib", "icon-paths.ts");
  const { LIGHT, DARK } = (await import(tokensPath)) as Record<"LIGHT" | "DARK", Record<string, string>>;
  const { ICON_PATHS } = (await import(iconsPath)) as {
    ICON_PATHS: Record<string, { paths: readonly IconPathSpec[] }>;
  };

  const pick = (palette: Record<string, string>) =>
    Object.fromEntries(PALETTE_KEYS.map((k) => {
      const v = palette[k];
      if (!v || !/^#[0-9A-F]{6}$/i.test(v)) throw new Error(`tokens.ts has no 6-digit hex for ${k}`);
      return [k, v];
    }));

  const glyphs = Object.fromEntries(Object.entries(GLYPHS).map(([name, icon]) => {
    const art = ICON_PATHS[icon];
    if (!art) throw new Error(`icon-paths.ts has no ${icon}`);
    return [name, glyphSvg(art.paths)];
  }));

  const json = (v: unknown) => JSON.stringify(v, null, 2);
  // The html comes first so a TODO(domain) marker sits within the lines the
  // placeholder check reads above each use (DOMAIN-PLACEHOLDERS.md).
  const legal = (name: string, { title, updated, html }: LegalPage) =>
    (/latchet\.app/.test(html)
      ? "// TODO(domain): its support@latchet.app is a placeholder until latchet.app is bought.\n"
      : "") + `export const ${name} = ${json({ html, title, updated })} as const;`;
  return `// GENERATED by scripts/build-site.ts from PRIVACY.md, TERMS.md and the app's
// identity (mobile/src/lib/identity/tokens.ts, mobile/src/lib/icon-paths.ts).
// Do not edit: change a source and run \`bun scripts/build-site.ts\`.

export const PALETTE = ${json({ light: pick(LIGHT), dark: pick(DARK) })} as const;

export const GLYPHS = ${json(glyphs)} as const;

${legal("PRIVACY", privacy)}

${legal("TERMS", terms)}
`;
}

if (import.meta.main) {
  const next = await buildSite();
  if (process.argv.includes("--check")) {
    const current = readFileSync(GENERATED_PATH, "utf8");
    if (current !== next) {
      console.error("src/site/generated.ts is out of date: run `bun scripts/build-site.ts`");
      process.exit(1);
    }
    console.log("src/site/generated.ts is up to date");
  } else {
    writeFileSync(GENERATED_PATH, next);
    console.log(`wrote src/site/generated.ts (${next.length} bytes)`);
  }
}
