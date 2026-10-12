/**
 * HTML email → readable text.
 *
 * Billing emails are table layouts full of hidden preheaders, Outlook
 * conditional comments and inline styles. What extraction needs is the text a
 * person sees, with each table row on one line ("Total  12,99 €") and blocks
 * kept apart. A tolerant tree builder (implicit closes for p/li/td/tr, unknown
 * end tags ignored) feeds a renderer that drops invisible subtrees.
 */

import { decodeEntities } from "./entities";

/** Larger HTML is cut: real billing emails are well under this. */
export const MAX_HTML_CHARS = 1_000_000;
/** A tag longer than this is not a tag (it is text with a stray "<"). */
const MAX_TAG_CHARS = 2_048;
/** Deeper elements are flattened into their ancestor, so rendering never recurses without bound. */
export const MAX_DEPTH = 256;

const VOID = new Set([
  "area", "base", "basefont", "br", "col", "embed", "frame", "hr", "img", "input",
  "keygen", "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements whose content is never shown. Raw-text ones are skipped by search, not parsed. */
const RAW_DROP = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes"]);
const DROP = new Set(["head", "template", "svg", "math", "object", "canvas", "map", "select", "button", "video", "audio"]);

const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details", "dialog",
  "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hgroup", "html", "legend", "li", "listing", "main", "menu", "nav",
  "ol", "p", "pre", "section", "summary", "ul", "tbody", "thead", "tfoot", "colgroup",
]);

interface ElementNode {
  tag: string;
  children: Node[];
  hidden: boolean;
  /** display:inline / inline-block on a block element. */
  inline: boolean;
}
type Node = ElementNode | string;

/** Matched against a window of at most MAX_TAG_CHARS, so an unclosed quote cannot make it scan the document. */
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/;
const STYLE_RE = /(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

function styleOf(attrs: string): string | null {
  const m = STYLE_RE.exec(attrs);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

function isHidden(attrs: string): boolean {
  if (/(?:^|\s)hidden(?:\s|=|\/|$)/i.test(attrs)) return true;
  const style = styleOf(attrs);
  if (!style) return false;
  const s = style.toLowerCase().replace(/\s+/g, "");
  if (/(?:^|;)display:none/.test(s)) return true;
  if (/(?:^|;)visibility:hidden/.test(s)) return true;
  if (/(?:^|;)mso-hide:all/.test(s)) return true;
  if (/(?:^|;)opacity:0(?:\.0+)?(?:;|!|$)/.test(s)) return true;
  // Collapsed boxes: the preheader trick (max-height:0; overflow:hidden).
  const collapsed = /(?:^|;)(?:max-)?(?:height|width):0(?:px|em|%)?(?:;|!|$)/.test(s);
  return collapsed && /(?:^|;)overflow:hidden/.test(s);
}

function isInlineStyled(attrs: string): boolean {
  const style = styleOf(attrs);
  return !!style && /(?:^|;)\s*display\s*:\s*inline(?:-block)?\s*(?:;|!|$)/i.test(style);
}

/** Strip comments, doctype, CDATA and processing instructions. */
function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, " ")
    .replace(/<![^>]{0,2048}>/g, " ")
    .replace(/<\?[\s\S]*?(?:\?>|$)/g, " ");
}

function buildTree(input: string): ElementNode {
  const html = stripNonContent(input.length > MAX_HTML_CHARS ? input.slice(0, MAX_HTML_CHARS) : input);
  const root: ElementNode = { tag: "#root", children: [], hidden: false, inline: false };
  const stack: ElementNode[] = [root];
  const top = () => stack[stack.length - 1]!;

  /** Pop up to and including the nearest `tag`, unless a boundary tag comes first. */
  const closeTo = (tags: Set<string>, boundaries: Set<string>): boolean => {
    for (let i = stack.length - 1; i > 0; i--) {
      const t = stack[i]!.tag;
      if (tags.has(t)) {
        stack.length = i;
        return true;
      }
      if (boundaries.has(t)) return false;
    }
    return false;
  };

  const TABLE_B = new Set(["table"]);
  const ROW_B = new Set(["tr", "table"]);
  const LIST_B = new Set(["ul", "ol", "table", "td", "th"]);
  const P_B = new Set(["td", "th", "table", "li", "div", "blockquote", "section", "article", "body", "html"]);

  let i = 0;
  let nextGt = -1;
  // Total scanning allowed for tags: a few passes over the document. Real HTML
  // spends one; text built to defeat the scanner runs out and is read as text.
  let budget = 4 * html.length + 100_000;
  const len = html.length;
  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      top().children.push(html.slice(i));
      break;
    }
    if (lt > i) top().children.push(html.slice(i, lt));
    // Every tag ends at or after the next ">"; when that is out of reach this "<" is text.
    if (nextGt < lt) {
      const gt = html.indexOf(">", lt);
      nextGt = gt < 0 ? Number.POSITIVE_INFINITY : gt;
    }
    let m: RegExpExecArray | null = null;
    if (nextGt - lt < MAX_TAG_CHARS && budget > 0) {
      // Usually the tag ends at that ">". A quoted ">" inside an attribute needs a
      // wider window, and only quotes can make the first try fail.
      const first = html.slice(lt, nextGt + 1);
      budget -= first.length;
      m = TAG_RE.exec(first);
      if (!m && /["']/.test(first)) {
        budget -= MAX_TAG_CHARS;
        m = TAG_RE.exec(html.slice(lt, lt + MAX_TAG_CHARS));
      }
    }
    if (!m) {
      top().children.push("<");
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? "";

    if (closing) {
      if (tag === "br") {
        top().children.push({ tag: "br", children: [], hidden: false, inline: false });
        continue;
      }
      if (tag === "td" || tag === "th") closeTo(new Set(["td", "th"]), ROW_B);
      else if (tag === "tr") closeTo(new Set(["tr"]), TABLE_B);
      else if (tag === "p") closeTo(new Set(["p"]), P_B);
      else closeTo(new Set([tag]), new Set());
      continue;
    }

    if (RAW_DROP.has(tag)) {
      if (/\/\s*$/.test(attrs)) continue;
      const endRe = new RegExp(`</${tag}[^>]*>`, "gi");
      endRe.lastIndex = i;
      const end = endRe.exec(html);
      i = end ? endRe.lastIndex : len;
      continue;
    }

    // Implicit closes, as a browser would.
    if (tag === "td" || tag === "th") closeTo(new Set(["td", "th"]), ROW_B);
    else if (tag === "tr") closeTo(new Set(["tr"]), TABLE_B);
    else if (tag === "tbody" || tag === "thead" || tag === "tfoot") closeTo(new Set(["tbody", "thead", "tfoot"]), TABLE_B);
    else if (tag === "li") closeTo(new Set(["li"]), LIST_B);
    else if (tag === "dt" || tag === "dd") closeTo(new Set(["dt", "dd"]), new Set(["dl"]));
    if (tag === "p" || (BLOCK.has(tag) && tag !== "body" && tag !== "html") || tag === "table") {
      // A block start closes an open <p> in the same container.
      const t = top();
      if (t.tag === "p") stack.pop();
    }

    const isVoid = VOID.has(tag) || /\/\s*$/.test(attrs);
    if (!isVoid && stack.length >= MAX_DEPTH) {
      // Too deep to be a real layout: keep the text, keep blocks apart, drop the element.
      if (BLOCK.has(tag) || tag === "tr" || tag === "table") top().children.push({ tag: "br", children: [], hidden: false, inline: false });
      continue;
    }
    const node: ElementNode = {
      tag,
      children: [],
      hidden: DROP.has(tag) || isHidden(attrs),
      inline: isInlineStyled(attrs),
    };
    top().children.push(node);
    if (!isVoid) stack.push(node);
  }
  return root;
}

const WS = /[ \t\r\n\f]+/g;

function renderChildren(node: ElementNode, pre: boolean): string {
  let out = "";
  for (const child of node.children) out += render(child, pre);
  return out;
}

/** A cell's text: blank lines squeezed, edges trimmed. */
function cellText(node: ElementNode, pre: boolean): string {
  return squeeze(renderChildren(node, pre));
}

function squeeze(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

function render(node: Node, pre: boolean): string {
  if (typeof node === "string") {
    const text = decodeEntities(node);
    return pre ? text : text.replace(WS, " ");
  }
  if (node.hidden) return "";
  const tag = node.tag;
  switch (tag) {
    case "br":
      return "\n";
    case "hr":
      return "\n\n";
    case "img":
    case "input":
    case "meta":
    case "link":
      return "";
    case "pre":
      return "\n" + renderChildren(node, true) + "\n";
    case "td":
    case "th":
      return " " + cellText(node, pre) + " ";
    case "tr": {
      const cells = node.children
        .filter((c): c is ElementNode => typeof c !== "string" && !c.hidden)
        .map((c) => (c.tag === "td" || c.tag === "th" ? cellText(c, pre) : squeeze(render(c, pre))))
        .filter((c) => c.length > 0);
      // A row of one-line cells reads as one line ("Total  12,99 €"); a layout
      // row whose cells hold whole blocks keeps them apart.
      const flat = cells.every((c) => !c.includes("\n"));
      return "\n" + cells.join(flat ? "  " : "\n") + "\n";
    }
    case "table":
    case "tbody":
    case "thead":
    case "tfoot":
      return "\n" + renderChildren(node, pre) + "\n";
    default:
      if (BLOCK.has(tag) && !node.inline) return "\n" + renderChildren(node, pre) + "\n";
      if (node.inline && BLOCK.has(tag)) return " " + renderChildren(node, pre) + " ";
      return renderChildren(node, pre);
  }
}

/** The visible text of an HTML document, one block or table row per line, no blank lines. */
export function htmlToText(html: string): string {
  if (!html) return "";
  const tree = buildTree(html);
  const raw = renderChildren(tree, false);
  // One block or row per line; blank lines carry nothing an extractor needs.
  return raw
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}
