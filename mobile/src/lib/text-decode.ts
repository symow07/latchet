/**
 * Bytes of an imported statement file → text.
 *
 * Banks export in whatever their software defaults to. French and Moroccan
 * banks often export Windows-1252 (Latin-1 plus €, curly quotes and dashes);
 * Excel's "Unicode text" is UTF-16 with a byte-order mark; everyone else uses
 * UTF-8, sometimes with a BOM. Reading every file as UTF-8 turned "Libellé"
 * into "Libell�" and dropped the euro sign.
 *
 * Pure JavaScript on purpose: Hermes's TextDecoder support is not something
 * to rely on for legacy encodings, and this needs no native module.
 */

/** Windows-1252's 0x80–0x9F, where it differs from Latin-1. Undefined bytes map to themselves. */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

/** Strict UTF-8; null on any invalid sequence (overlong, surrogate, truncated). */
export function decodeUtf8Strict(bytes: Uint8Array, start = 0): string | null {
  const out: string[] = [];
  let chunk: number[] = [];
  const flush = () => { if (chunk.length) { out.push(String.fromCodePoint(...chunk)); chunk = []; } };
  for (let i = start; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp: number, need: number, min: number;
    if (b < 0x80) { cp = b; need = 0; min = 0; }
    else if (b >= 0xc2 && b <= 0xdf) { cp = b & 0x1f; need = 1; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { cp = b & 0x0f; need = 2; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { cp = b & 0x07; need = 3; min = 0x10000; }
    else return null;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    chunk.push(cp);
    if (chunk.length >= 4096) flush();
    i += need + 1;
  }
  flush();
  return out.join('');
}

function decodeUtf16(bytes: Uint8Array, start: number, littleEndian: boolean): string {
  const out: string[] = [];
  let units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    units.push(littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!);
    if (units.length >= 4096) { out.push(String.fromCharCode(...units)); units = []; }
  }
  if (units.length) out.push(String.fromCharCode(...units));
  return out.join('');
}

export function decodeWindows1252(bytes: Uint8Array, start = 0): string {
  const out: string[] = [];
  let units: number[] = [];
  for (let i = start; i < bytes.length; i++) {
    const b = bytes[i]!;
    units.push(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b] ?? b : b);
    if (units.length >= 4096) { out.push(String.fromCharCode(...units)); units = []; }
  }
  if (units.length) out.push(String.fromCharCode(...units));
  return out.join('');
}

/** Decode a statement file, choosing the encoding from its BOM, else UTF-8 when valid, else Windows-1252. */
export function decodeStatementBytes(bytes: Uint8Array): { text: string; encoding: TextEncodingName } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeUtf8Strict(bytes, 3) ?? decodeWindows1252(bytes, 3), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decodeUtf16(bytes, 2, true), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decodeUtf16(bytes, 2, false), encoding: 'utf-16be' };
  const utf8 = decodeUtf8Strict(bytes);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };
  return { text: decodeWindows1252(bytes), encoding: 'windows-1252' };
}

/** Base64 (what expo-file-system returns for binary reads) → bytes, without atob. */
export function base64ToBytes(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (alphabet.indexOf(clean[i]!) << 18) | (alphabet.indexOf(clean[i + 1] ?? 'A') << 12)
      | ((i + 2 < clean.length ? alphabet.indexOf(clean[i + 2]!) : 0) << 6) | (i + 3 < clean.length ? alphabet.indexOf(clean[i + 3]!) : 0);
    out[o++] = (n >> 16) & 0xff;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 0xff;
    if (i + 3 < clean.length) out[o++] = n & 0xff;
  }
  return out.subarray(0, o);
}
