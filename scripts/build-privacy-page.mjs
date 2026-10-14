/**
 * Render PRIVACY.md to a standalone page for GitHub Pages.
 *
 * PRIVACY.md stays the single source: the published policy is generated from
 * it on every change, so the hosted page cannot drift from the repository — and
 * App Review compares the two.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';

const markdown = readFileSync('PRIVACY.md', 'utf8')
  // Strip HTML comments (internal TODOs) so they never reach the public page.
  .replace(/<!--[\s\S]*?-->/g, '');

const body = marked.parse(markdown, { gfm: true });

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Latchet — Privacy Policy</title>
<meta name="description" content="How Latchet handles your data.">
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fff; --muted:#666; --line:#e5e5e5; --accent:#7c3aed; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8ea; --bg:#0e0b14; --muted:#9a97a5; --line:#2a2533; --accent:#a855f7; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 3rem 1.25rem 6rem; max-width: 46rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--fg); background: var(--bg);
  }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .5rem; }
  h2 { font-size: 1.25rem; margin: 2.5rem 0 .75rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
  a { color: var(--accent); }
  em { color: var(--muted); font-style: normal; }
  code { background: color-mix(in srgb, var(--fg) 8%, transparent); padding: .15em .4em; border-radius: 4px; font-size: .9em; }
  ul { padding-left: 1.25rem; }
  li { margin: .4rem 0; }
  /* Tables carry the substance here, so let them scroll rather than overflow. */
  .table-wrap { overflow-x: auto; margin: 1rem 0; }
  table { border-collapse: collapse; width: 100%; font-size: .93rem; }
  th, td { text-align: left; vertical-align: top; padding: .6rem .75rem; border-bottom: 1px solid var(--line); }
  th { font-weight: 600; white-space: nowrap; }
  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .875rem; }
</style>
</head>
<body>
<main>
${body}
</main>
<footer>
  Source: <a href="https://github.com/symow07/latchet/blob/main/PRIVACY.md">PRIVACY.md</a> —
  this page is generated from it on every change.
</footer>
<script>
  // Wrap tables so they scroll on narrow screens instead of breaking the layout.
  for (const t of document.querySelectorAll('table')) {
    const w = document.createElement('div');
    w.className = 'table-wrap';
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
  }
</script>
</body>
</html>
`;

mkdirSync('_site', { recursive: true });
writeFileSync('_site/index.html', page);
console.log(`built _site/index.html (${page.length} bytes)`);
