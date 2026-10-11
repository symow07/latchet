/**
 * Redraw the app icon, Android adaptive foreground, splash marks and favicon
 * from the design identity's tokens.
 *
 *   bun scripts/generate-app-icons.ts
 *
 * The mark is the open ring the app has always used: an arc from 36° to 324°
 * round the top, with round caps. Only its colours changed with the identity.
 * The old assets were violet (a #7C3AED field under a white ring, and a navy
 * splash ring), so the first thing anyone saw, the icon on the home screen and
 * on every notification, was the theme the rest of the app had left.
 *
 *   icon            platinum ring on a flat espresso field
 *   adaptive-icon   platinum ring on transparent (app.json fills it espresso)
 *   splash (light)  espresso ring on transparent, over the off-white ground
 *   splash (dark)   platinum ring on transparent, over the dark ground
 *   favicon         the icon at 48 px
 *
 * The platinum is the identity's only gradient: the silver sheen, its
 * highlight at the top. Everything is drawn analytically (a signed distance to
 * the arc, one pixel of anti-aliasing) and encoded with node:zlib, so there is
 * no image tool or package to install and the output is the same on every
 * machine. Geometry was measured from the previous assets so the mark keeps
 * its exact proportions.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { DARK, LIGHT } from '../src/lib/identity/tokens';

type RGB = [number, number, number];

const hex = (h: string): RGB =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

/** The gap is centred on the top: the arc runs from GAP to 360 − GAP. */
const GAP_DEG = 36;

interface Ring {
  /** Centre-line radius, as a fraction of the canvas. */
  radius: number;
  /** Stroke width, as a fraction of the canvas. */
  stroke: number;
}

// Measured from the previous assets (1024 px canvases).
const ICON_RING: Ring = { radius: 267 / 1024, stroke: 99 / 1024 };
const ADAPTIVE_RING: Ring = { radius: 164.5 / 1024, stroke: 80 / 1024 };
const SPLASH_RING: Ring = { radius: 192.5 / 1024, stroke: 86 / 1024 };

/** Distance from (x, y) to the ring's centre line, caps included. */
function distanceToArc(x: number, y: number, r: number): number {
  // Angle clockwise from straight up, in degrees, 0–360.
  const deg = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  if (deg >= GAP_DEG && deg <= 360 - GAP_DEG) {
    return Math.abs(Math.hypot(x, y) - r);
  }
  // In the gap: the nearer of the two cap centres.
  const t = (GAP_DEG * Math.PI) / 180;
  const cap = (s: number) => Math.hypot(x - s * r * Math.sin(t), y + r * Math.cos(t));
  return Math.min(cap(1), cap(-1));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** An 8-bit RGBA buffer as a PNG: RGB when `opaque`, RGBA otherwise. */
function encodePng(size: number, rgba: Uint8Array, opaque: boolean): Buffer {
  const channels = opaque ? 3 : 4;
  const raw = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * channels + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < channels; k++) {
        raw[row + 1 + x * channels + k] = rgba[(y * size + x) * 4 + k]!;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(
  size: number,
  ring: Ring,
  field: RGB | null,
  ink: (v: number) => RGB,
): Buffer {
  const png = { data: new Uint8Array(size * size * 4) };
  const c = size / 2;
  const r = ring.radius * size;
  const half = (ring.stroke * size) / 2;
  const top = c - r - half;
  const span = 2 * (r + half);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5 - c;
      const y = py + 0.5 - c;
      const coverage = Math.min(1, Math.max(0, half - distanceToArc(x, y, r) + 0.5));
      const colour = ink(Math.min(1, Math.max(0, (py + 0.5 - top) / span)));
      const i = (py * size + px) * 4;
      if (field) {
        for (let k = 0; k < 3; k++) {
          png.data[i + k] = Math.round(colour[k] * coverage + field[k] * (1 - coverage));
        }
        png.data[i + 3] = 255;
      } else {
        png.data[i] = colour[0];
        png.data[i + 1] = colour[1];
        png.data[i + 2] = colour[2];
        png.data[i + 3] = Math.round(coverage * 255);
      }
    }
  }
  return encodePng(size, png.data, field !== null);
}

/** The silver sheen, top to bottom: highlight into the body of the metal. */
const sheen = (hi: string, body: string) => {
  const [a, b] = [hex(hi), hex(body)];
  return (v: number): RGB => [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * v)) as RGB;
};
const solid = (h: string) => () => hex(h);

const out = (name: string) => join(import.meta.dir, '..', 'assets', name);
const lightSilver = sheen(LIGHT.silverHi, LIGHT.silver);
const darkSilver = sheen(DARK.silverHi, DARK.silver);

writeFileSync(out('icon.png'), draw(1024, ICON_RING, hex(LIGHT.espresso), lightSilver));
writeFileSync(out('favicon.png'), draw(48, ICON_RING, hex(LIGHT.espresso), lightSilver));
writeFileSync(out('adaptive-icon.png'), draw(1024, ADAPTIVE_RING, null, lightSilver));
writeFileSync(out('splash-icon-light.png'), draw(1024, SPLASH_RING, null, solid(LIGHT.espresso)));
writeFileSync(out('splash-icon.png'), draw(1024, SPLASH_RING, null, darkSilver));

console.log('wrote icon, favicon, adaptive-icon, splash-icon-light, splash-icon');
