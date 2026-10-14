/**
 * The public website: a home page, the privacy policy and the terms of service.
 *
 * Google's OAuth Branding page needs all three as public URLs before the Gmail
 * connection can be published, and App Review needs the privacy policy. There
 * is no domain yet, so the backend serves them (routes/site.ts).
 *
 * The pages wear the app's identity (DESIGN-IDENTITY.md): the off-white page,
 * one espresso anchor, ink for text, platinum silver as the felt accent, the
 * system face. The palette, the glyphs and the two policies come from
 * generated.ts, which scripts/build-site.ts builds from the app's own sources.
 *
 * Every page is static, plain HTML: no script, no cookie, nothing loaded from
 * another site. PRIVACY.md says so ("This website"), and the tests hold it.
 */
import { createHash } from "node:crypto";
import { GLYPHS, PALETTE, PRIVACY, TERMS } from "./generated";

/** TODO(domain): placeholder until latchet.app is bought (LAUNCH-CHECKLIST §5). */
export const SUPPORT_EMAIL = "support@latchet.app";

type Palette = (typeof PALETTE)["light"] | (typeof PALETTE)["dark"];

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Search Console's HTML-tag verification value. Accepts the bare value or the
 * whole tag pasted by mistake; anything else is ignored with a warning, because
 * a typo in a website setting must never stop the API from booting.
 */
export function siteVerificationToken(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const token = value.match(/content=["']([^"']+)["']/)?.[1] ?? value;
  if (/^[A-Za-z0-9_-]{8,128}$/.test(token)) return token;
  console.warn("[site] GOOGLE_SITE_VERIFICATION is not a Search Console token; ignoring it");
  return null;
}

// ── The mark ────────────────────────────────────────────────────────────────

/**
 * The open ring from the app icon (mobile/scripts/generate-app-icons.ts): an arc
 * from 36° to 324° round the top, round caps, at the icon's proportions.
 */
function ringPath(size: number, radius: number): string {
  const c = size / 2;
  const t = (36 * Math.PI) / 180;
  const x = (s: number) => (c + s * radius * Math.sin(t)).toFixed(3);
  const y = (c - radius * Math.cos(t)).toFixed(3);
  const r = radius.toFixed(3);
  return `M${x(1)} ${y}A${r} ${r} 0 1 1 ${x(-1)} ${y}`;
}

/** The splash mark: the ring alone, in the current colour (espresso, or platinum in dark). */
const MARK_SVG = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><path d="${ringPath(32, (267 / 1024) * 32)}" fill="none" stroke="currentColor" stroke-width="${((99 / 1024) * 32).toFixed(3)}" stroke-linecap="round"/></svg>`;

/** The app icon at favicon size: the platinum ring on the espresso field. */
const FAVICON = (() => {
  const { espresso, silver, silverHi } = PALETTE.light;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${silverHi}"/><stop offset="1" stop-color="${silver}"/></linearGradient></defs><rect width="64" height="64" rx="14.3" fill="${espresso}"/><path d="${ringPath(64, (267 / 1024) * 64)}" fill="none" stroke="url(#p)" stroke-width="${((99 / 1024) * 64).toFixed(3)}" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
})();

// ── The stylesheet ──────────────────────────────────────────────────────────

function rgb(hex: string): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `${n(1)} ${n(3)} ${n(5)}`;
}

function vars(p: Palette, shadowScale: number): string {
  const tokens = Object.entries(p).map(([k, v]) => `--${k}:${v};`).join("");
  const s = rgb(p.shadow);
  const a = (o: number) => Math.min(1, o * shadowScale).toFixed(3);
  // DESIGN-IDENTITY "Depth": a contact shadow and an ambient one per surface.
  return `${tokens}--lift-rest:0 1px 3px rgb(${s} / ${a(0.08)}),0 10px 28px rgb(${s} / ${a(0.1)});--lift-anchor:0 3px 8px rgb(${s} / ${a(0.2)}),0 24px 48px rgb(${s} / ${a(0.3)});`;
}

const CSS = `
:root{color-scheme:light;${vars(PALETTE.light, 1)}--mark:var(--espresso);--gutter:clamp(16px,5vw,24px);--pad:clamp(20px,5vw,32px)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;${vars(PALETTE.dark, 2.6)}--mark:var(--silver)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--ground);color:var(--ink);font:400 17px/24px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow-wrap:break-word}
a{color:var(--tint);text-decoration-line:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--tint) 45%,transparent)}
a:hover{text-decoration-color:var(--tint)}
:focus-visible{outline:2px solid var(--tint);outline-offset:3px;border-radius:6px}
.skip{position:absolute;left:var(--gutter);top:-100px;padding:10px 14px;background:var(--surface);border-radius:12px;box-shadow:var(--lift-rest);z-index:2}
.skip:focus{top:12px}
.wrap{width:100%;max-width:1040px;margin:0 auto;padding:0 var(--gutter)}
.narrow{max-width:808px}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:76px}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:600;font-size:20px;line-height:24px;letter-spacing:-0.3px;min-height:44px}
.brand svg{color:var(--mark);flex:none}
.top nav{display:flex;gap:4px}
.top nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;color:var(--inkSoft);text-decoration:none;font-size:15px;line-height:20px;font-weight:500}
.top nav a:hover{background:var(--sunk);color:var(--ink)}
.top nav a[aria-current=page]{background:var(--tintSoft);color:var(--tint)}
main{padding-bottom:36px}
.anchor{position:relative;background:var(--espresso);color:var(--onEspresso);border-radius:30px;padding:clamp(28px,6vw,56px) var(--pad);box-shadow:var(--lift-anchor);margin-top:8px}
@media (prefers-color-scheme:dark){.anchor{outline:1px solid var(--silverEdge);outline-offset:-1px}}
.anchor a{color:var(--onEspresso);text-decoration-color:color-mix(in srgb,var(--silver) 60%,transparent)}
.anchor :focus-visible{outline-color:var(--silver)}
.chip{display:inline-block;margin:0 0 20px;padding:4px 12px;border:1px solid color-mix(in srgb,var(--silver) 55%,transparent);border-radius:999px;color:var(--silver);font-size:13px;line-height:18px;font-weight:500;letter-spacing:0.1px}
.anchor h1{margin:0;max-width:22ch;font-size:clamp(34px,6vw,44px);line-height:1.14;font-weight:600;letter-spacing:-0.025em;text-wrap:balance}
.lede{margin:16px 0 0;max-width:62ch;color:var(--onEspressoDim);font-size:17px;line-height:26px}
.sheen{height:3px;width:72px;margin:28px 0 0;border-radius:2px;background:linear-gradient(90deg,var(--silver),var(--silverHi) 50%,var(--silver))}
.anchor-links{display:flex;flex-wrap:wrap;gap:8px 10px;margin:20px 0 0;padding:0;list-style:none}
.anchor-links a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:18px;border:1px solid color-mix(in srgb,var(--silver) 40%,transparent);text-decoration:none;font-size:15px;line-height:20px;font-weight:500}
.anchor-links a:hover{background:color-mix(in srgb,var(--onEspresso) 8%,transparent)}
.doc-head h1{max-width:none}
.meta{margin:12px 0 0;color:var(--onEspressoDim);font-size:15px;line-height:20px;font-weight:500}
section{margin-top:36px}
h2.section{margin:0 0 16px;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.3px}
.card{background:var(--surface);border:1px solid var(--silverEdge);border-radius:24px;box-shadow:var(--lift-rest)}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;margin:0;padding:0;list-style:none}
.feature{padding:24px}
.feature h3{margin:16px 0 0;font-size:17px;line-height:22px;font-weight:600}
.feature p{margin:8px 0 0;color:var(--inkSoft)}
.tile{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:14px;background:var(--sunk);color:var(--inkSoft);border:1px solid var(--silverEdge)}
.tile svg{width:22px;height:22px}
.prose{padding:var(--pad)}
.prose>:first-child{margin-top:0}
.prose>:last-child{margin-bottom:0}
.prose p,.prose ul,.prose ol{margin:0 0 16px}
.prose ul,.prose ol{padding-left:22px}
.prose li{margin:8px 0}
.prose li::marker{color:var(--silverInk)}
.prose strong{font-weight:600}
.prose h2{margin:36px 0 12px;padding-top:28px;border-top:1px solid var(--hairline);font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.3px;scroll-margin-top:16px}
.prose>h2:first-child{padding-top:0;border-top:0}
.prose h3{margin:28px 0 8px;font-size:17px;line-height:22px;font-weight:600;scroll-margin-top:16px}
.prose code{padding:1px 6px;border-radius:6px;background:var(--sunk);font:500 0.88em/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.table-wrap{overflow-x:auto;margin:0 0 16px;border:1px solid var(--hairline);border-radius:18px}
table{border-collapse:collapse;width:100%;min-width:560px;font-size:15px;line-height:21px}
th,td{text-align:left;vertical-align:top;padding:12px 14px;border-bottom:1px solid var(--hairline)}
tr:last-child td{border-bottom:0}
th{background:var(--sunk);font-weight:600;color:var(--inkSoft);font-size:13px;line-height:18px}
.note{margin:20px 0 0;padding:16px 18px;border-radius:18px;background:var(--sunk);color:var(--inkSoft);font-size:15px;line-height:22px}
.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:36px 16px;margin-top:36px}
.split section{margin-top:0;display:flex;flex-direction:column}
.split .card{flex:1}
.contents{padding:20px var(--pad)}
.contents h2{margin:0 0 8px;font-size:13px;line-height:18px;font-weight:500;color:var(--inkDim)}
.contents ol{margin:0;padding:0;list-style:none;columns:2 240px;column-gap:24px}
.contents li{break-inside:avoid}
.contents a{display:block;padding:6px 0;color:var(--inkSoft);text-decoration:none;font-size:15px;line-height:20px}
.contents a:hover{color:var(--tint);text-decoration:underline}
.contents{margin-top:16px}
.doc{margin-top:16px}
@media (max-width:640px){.table-wrap{overflow:visible;border:0;border-radius:0}table,tbody,tr,td{display:block;width:100%;min-width:0}thead{display:none}tr{margin:0 0 12px;padding:8px 0;border:1px solid var(--hairline);border-radius:18px}td,tr:last-child td{border:0;padding:6px 16px}td::before{content:attr(data-label);display:block;margin-bottom:2px;color:var(--inkDim);font-size:13px;line-height:18px;font-weight:500}td:first-child{font-weight:600}td:first-child::before{content:none}}
footer{padding-top:8px;padding-bottom:48px;color:var(--inkDim);font-size:13px;line-height:18px}
footer .rule{border-top:1px solid var(--hairline);padding-top:20px;display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center}
footer a{color:var(--inkDim)}
footer a:hover{color:var(--tint)}
@media (max-width:520px){.top nav a{padding:0 10px}.brand span{font-size:18px}}
`.trim().replace(/\n/g, "");

/** The stylesheet's CSP hash: the only style the pages allow, and no script at all. */
const STYLE_HASH = createHash("sha256").update(CSS).digest("base64");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "public, max-age=300",
};

// ── Layout ──────────────────────────────────────────────────────────────────

type Path = "/" | "/privacy" | "/terms";

interface Shell {
  path: Path;
  title: string;
  description: string;
  main: string;
  head?: string;
  narrow?: boolean;
}

function navLink(href: Path, label: string, current: Path): string {
  return `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`;
}

function layout({ path, title, description, main, head = "", narrow = false }: Shell): string {
  const year = new Date().getUTCFullYear();
  const width = narrow ? "wrap narrow" : "wrap";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="${PALETTE.light.ground}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${PALETTE.dark.ground}" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="Latchet">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<link rel="icon" href="${FAVICON}">${head}
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="${width}">
<a class="brand" href="/" aria-label="Latchet, home">${MARK_SVG}<span>Latchet</span></a>
<nav aria-label="Site">${navLink("/privacy", "Privacy", path)}${navLink("/terms", "Terms", path)}</nav>
</div></header>
<main id="main" class="${width}">
${main}
</main>
<footer class="${width}"><div class="rule">
<span>© ${year} Latchet · Free beta</span>
<a href="/privacy">Privacy policy</a>
<a href="/terms">Terms of service</a>
<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
</div></footer>
</body>
</html>
`;
}

// ── Home ────────────────────────────────────────────────────────────────────

// The copy follows docs/verification/homepage-content.md, which records what
// Google's reviewers look for. Keep its facts in step with PRIVACY.md.
const FEATURES: ReadonlyArray<{ glyph: keyof typeof GLYPHS; title: string; body: string }> = [
  {
    glyph: "wallet",
    title: "Budgets and spending",
    body: "Add expenses in seconds, set monthly budgets, and see where your money goes, in your own currency.",
  },
  {
    glyph: "repeat",
    title: "Subscriptions it finds for you",
    body: "Latchet spots recurring charges in your bank feed, your imported statements and your billing email, and merges them, so Netflix appears once even if it shows up in all three.",
  },
  {
    glyph: "bell",
    title: "Reminders before you pay",
    body: "A heads-up before each renewal and before a free trial turns into a paid plan, plus an alert when a price goes up or a cancelled service charges you again.",
  },
  {
    glyph: "receipt",
    title: "Help cancelling",
    body: "Step-by-step instructions and direct links for each service, including subscriptions billed through Apple or Google Play.",
  },
  {
    glyph: "card",
    title: "Your bank, or your statements",
    body: "Link your bank through Plaid for automatic transactions, or import the statements you already have. Latchet never sees your bank password.",
  },
  {
    glyph: "phone",
    title: "Your data, on your phone",
    body: "Your budget works offline on your phone and syncs to your account, so a new phone gets it back.",
  },
];

const LIMITED_USE = `Latchet's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes">Limited Use requirements</a>.`;

function homeMain(): string {
  const features = FEATURES.map((f) =>
    `<li class="card feature"><span class="tile">${GLYPHS[f.glyph]}</span><h3>${f.title}</h3><p>${f.body}</p></li>`,
  ).join("\n");
  return `<section class="anchor" aria-labelledby="hero-title">
<p class="chip">Free beta</p>
<h1 id="hero-title">Every subscription and free trial, caught before it charges you.</h1>
<p class="lede">Latchet tracks your spending and budgets, and finds the recurring charges you forgot about: in your bank feed, in the statements you import, and in your email receipts. It reminds you before the next charge, so you can keep it or cancel it in time.</p>
<div class="sheen"></div>
<ul class="anchor-links">
<li><a href="#inbox">How inbox reading works</a></li>
<li><a href="/privacy">Privacy policy</a></li>
<li><a href="/terms">Terms of service</a></li>
</ul>
</section>

<section aria-labelledby="does">
<h2 class="section" id="does">What Latchet does</h2>
<ul class="features">
${features}
</ul>
</section>

<section aria-labelledby="inbox">
<h2 class="section" id="inbox">How inbox reading works</h2>
<div class="card prose">
<p>Connecting your email is optional. You can also forward receipts by hand, or not use email at all.</p>
<ul>
<li><strong>Gmail and Outlook.</strong> You sign in with Google or Microsoft and grant read-only access: Google's <code>gmail.readonly</code> permission or Microsoft's <code>Mail.Read</code> permission. Latchet can never send, delete, move or change your email.</li>
<li><strong>Only billing email.</strong> On the first connection, Latchet looks for receipts, invoices, renewal and trial notices, price changes and cancellations from the past 12 months. After that, it checks new mail only. Other mail is not opened or kept.</li>
<li><strong>Only a few facts are kept.</strong> From each billing email Latchet keeps the merchant, the sender's website (such as <code>netflix.com</code>), the amount, the currency, the billing cycle and the dates. Never the message itself, its attachments, or the email addresses in it.</li>
<li><strong>Rules first, AI only as a fallback.</strong> Billing emails are read by rules on our server. If AI reading is on and the rules cannot read an email, its text may be sent to OpenAI to extract the same details. OpenAI does not train on it.</li>
<li><strong>Never sold, never used for ads.</strong> Your email data is not sold, not used for advertising, not used to judge your credit, and not used to train AI. Nobody at Latchet reads it.</li>
<li><strong>Other providers.</strong> For iCloud, Yahoo, GMX and others, forward billing emails to your private Latchet address. They are read and kept the same way.</li>
</ul>
<p class="note">${LIMITED_USE}</p>
</div>
</section>

<div class="split">
<section aria-labelledby="control">
<h2 class="section" id="control">Disconnect and delete, any time</h2>
<div class="card prose">
<ul>
<li><strong>Disconnect an inbox</strong> in the app. Latchet stops reading it at once and deletes everything it found there. For Gmail, it also withdraws its access with Google. Microsoft gives apps no way to withdraw their own access to a personal Outlook account, so Latchet deletes its keys to your mailbox. You can also remove the app yourself at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> or <a href="https://account.live.com/consent/Manage">account.live.com/consent/Manage</a>.</li>
<li><strong>Disconnect a bank</strong> in the app. Plaid's access is withdrawn and the connection is deleted.</li>
<li><strong>Delete your account</strong> in the app: Settings → Delete Account. Latchet withdraws every inbox and bank connection first, then deletes your account and everything in it, immediately and permanently.</li>
</ul>
</div>
</section>

<section aria-labelledby="security">
<h2 class="section" id="security">Security</h2>
<div class="card prose">
<ul>
<li>Everything travels over HTTPS.</li>
<li>The keys to your inbox and your bank connection are encrypted on our server (AES-256-GCM).</li>
<li>Your password is never stored, only a strong one-way hash of it.</li>
<li>This website sets no cookies and runs no scripts or analytics.</li>
</ul>
</div>
</section>
</div>

<section aria-labelledby="questions">
<h2 class="section" id="questions">Questions</h2>
<div class="card prose">
<p>Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
<p>The <a href="/privacy">privacy policy</a> lists exactly what Latchet collects, why, who processes it and for how long. The <a href="/terms">terms of service</a> cover the free beta, your data and how to delete your account.</p>
</div>
</section>`;
}

// ── Policies ────────────────────────────────────────────────────────────────

function legalMain(doc: { title: string; updated: string; html: string }): string {
  const sections = [...doc.html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)]
    .map(([, id, text]) => `<li><a href="#${id}">${text}</a></li>`)
    .join("");
  return `<header class="anchor doc-head">
<h1>${escapeHtml(doc.title)}</h1>
<p class="meta">Last updated ${escapeHtml(doc.updated)}</p>
<div class="sheen"></div>
</header>
<nav class="card contents" aria-labelledby="contents-title"><h2 id="contents-title">On this page</h2><ol>${sections}</ol></nav>
<article class="card prose doc">
${doc.html}
</article>`;
}

// ── Pages ───────────────────────────────────────────────────────────────────

export interface SitePages {
  "/": string;
  "/privacy": string;
  "/terms": string;
}

export function renderSite(options: { siteVerification?: string | null } = {}): SitePages {
  const verification = options.siteVerification
    ? `\n<meta name="google-site-verification" content="${escapeHtml(options.siteVerification)}">`
    : "";
  return {
    "/": layout({
      path: "/",
      title: "Latchet: find the subscriptions you forgot",
      description:
        "Latchet tracks your spending and budgets, finds the subscriptions and free trials you forgot, and reminds you before the next charge.",
      head: verification,
      main: homeMain(),
    }),
    "/privacy": layout({
      path: "/privacy",
      title: "Privacy Policy · Latchet",
      description: "What Latchet collects, why, who processes it, how long it is kept, and how to delete it.",
      main: legalMain(PRIVACY),
      narrow: true,
    }),
    "/terms": layout({
      path: "/terms",
      title: "Terms of Service · Latchet",
      description: "The terms for using Latchet's free beta: your data is yours, no warranties, and how to delete your account.",
      main: legalMain(TERMS),
      narrow: true,
    }),
  };
}
