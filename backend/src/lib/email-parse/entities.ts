/**
 * HTML character references, decoded the way a browser reads them in text:
 * numeric references (with the windows-1252 remap of &#128;–&#159;, so &#128;
 * is €), and the named references billing emails actually use — Latin-1,
 * typography, currency signs and the HTML5 punctuation names.
 */

const NAMED: Record<string, string> = {
  // Markup and spaces
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", NonBreakingSpace: "\u00a0",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", hairsp: "\u200a", numsp: "\u2007", puncsp: "\u2008",
  zwnj: "\u200c", zwj: "\u200d", lrm: "\u200e", rlm: "\u200f", shy: "\u00ad", ZeroWidthSpace: "\u200b",
  NewLine: "\n", Tab: "\t",
  // Currency
  euro: "€", pound: "£", yen: "¥", cent: "¢", curren: "¤", dollar: "$",
  // Typography
  ndash: "–", mdash: "—", horbar: "―", hyphen: "‐", dash: "‐", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“",
  rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", hellip: "…", mldr: "…",
  bull: "•", bullet: "•", middot: "·", centerdot: "·", prime: "′", Prime: "″", dagger: "†", Dagger: "‡",
  permil: "‰", trade: "™", TRADE: "™", copy: "©", COPY: "©", reg: "®", REG: "®", deg: "°", plusmn: "±",
  times: "×", divide: "÷", minus: "−", frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³",
  micro: "µ", para: "¶", sect: "§", ordf: "ª", ordm: "º", iexcl: "¡", iquest: "¿", brvbar: "¦", uml: "¨",
  macr: "¯", acute: "´", cedil: "¸", not: "¬", circ: "ˆ", tilde: "˜", larr: "←", rarr: "→", uarr: "↑",
  darr: "↓", harr: "↔", rArr: "⇒", check: "✓", checkmark: "✓", star: "☆", starf: "★", hearts: "♥",
  // HTML5 ASCII punctuation names
  excl: "!", num: "#", percnt: "%", lpar: "(", rpar: ")", ast: "*", midast: "*", plus: "+", comma: ",",
  period: ".", sol: "/", colon: ":", semi: ";", equals: "=", quest: "?", commat: "@", lsqb: "[", lbrack: "[",
  rsqb: "]", rbrack: "]", bsol: "\\", lowbar: "_", grave: "`", lcub: "{", lbrace: "{", rcub: "}", rbrace: "}",
  verbar: "|", vert: "|", VerticalLine: "|", Hat: "^",
  // Latin-1 and Latin Extended-A letters seen in French, Spanish and German mail
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", THORN: "Þ", szlig: "ß",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  eth: "ð", ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", thorn: "þ", yuml: "ÿ",
  OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ", fnof: "ƒ",
};

/** Names a browser also accepts without the trailing semicolon. */
const LEGACY_NO_SEMI = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy", "reg", "AMP", "LT", "GT", "QUOT"]);

/** windows-1252 meanings of the C1 range, which is what &#128;–&#159; mean in HTML. */
const C1: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function fromCodePoint(cp: number): string {
  if (cp >= 0x80 && cp <= 0x9f) return String.fromCodePoint(C1[cp] ?? cp);
  // NUL, surrogates and out-of-range references carry no text; drop them rather
  // than emit a replacement character.
  if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return "";
  return String.fromCodePoint(cp);
}

const ENTITY_RE = /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}))(;?)/g;

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(ENTITY_RE, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined, semi: string) => {
    if (dec !== undefined) return fromCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
    if (name !== undefined) {
      const value = NAMED[name] ?? (LEGACY_NO_SEMI.has(name) ? NAMED[name.toLowerCase()] : undefined);
      if (value !== undefined && (semi === ";" || LEGACY_NO_SEMI.has(name))) return value;
    }
    return whole;
  });
}
