#!/usr/bin/env node
// Compares two end-to-end runs' screenshots, screen by screen. See e2e/README.md.
//
//   node e2e/compare.mjs step2 step3
//
// For every screenshot both runs took, the share of its pixels that changed,
// leaving out the status bar (its clock always differs). A number only says
// where to look: the run's own data differs every time (dates, amounts, the
// run number in names). So each screen that changed also gets one image,
// before | after | the changed pixels in red, in
// e2e/screenshots/compare-<a>-<b>/, to look at.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PNG } = createRequire(import.meta.url)('pngjs');

const here = dirname(fileURLToPath(import.meta.url));
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: node e2e/compare.mjs <label-before> <label-after>');
  process.exit(2);
}
const dirA = join(here, 'screenshots', a);
const dirB = join(here, 'screenshots', b);
for (const dir of [dirA, dirB]) {
  if (!existsSync(dir)) {
    console.error(`compare: no screenshots at ${dir}`);
    process.exit(2);
  }
}
const out = join(here, 'screenshots', `compare-${a}-${b}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** A pixel counts as changed when any channel moved by more than this. */
const CHANNEL_TOLERANCE = 32;
/** The status bar: the top of the screen, left out of the measure. */
const STATUS_BAR_SHARE = 0.072;
/** Below this share, a screen is reported as unchanged and gets no image. */
const UNCHANGED_BELOW = 0.002;
/** The side-by-side images are this many times smaller than the screenshots. */
const SCALE = 3;

const shots = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith('.png') && !f.startsWith('FAILED-')).sort();
const before = new Set(shots(dirA));
const after = new Set(shots(dirB));
const both = [...before].filter((f) => after.has(f));

const rows = [];
for (const name of both) {
  const pa = PNG.sync.read(readFileSync(join(dirA, name)));
  const pb = PNG.sync.read(readFileSync(join(dirB, name)));
  if (pa.width !== pb.width || pa.height !== pb.height) {
    rows.push({ name, share: 1, note: `size ${pa.width}x${pa.height} → ${pb.width}x${pb.height}` });
    continue;
  }
  const { width, height } = pa;
  const top = Math.round(height * STATUS_BAR_SHARE);
  const mask = new Uint8Array(width * height);
  let changed = 0;
  for (let y = top; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = Math.max(
        Math.abs(pa.data[i] - pb.data[i]),
        Math.abs(pa.data[i + 1] - pb.data[i + 1]),
        Math.abs(pa.data[i + 2] - pb.data[i + 2]),
      );
      if (d > CHANNEL_TOLERANCE) {
        mask[y * width + x] = 1;
        changed++;
      }
    }
  }
  const share = changed / (width * (height - top));
  rows.push({ name, share });
  if (share >= UNCHANGED_BELOW) writeSideBySide(name, pa, pb, mask);
}

/** before | after | after, faded, with the changed pixels in red. */
function writeSideBySide(name, pa, pb, mask) {
  const w = Math.floor(pa.width / SCALE);
  const h = Math.floor(pa.height / SCALE);
  const gap = 8;
  const img = new PNG({ width: w * 3 + gap * 2, height: h });
  img.data.fill(255);
  const put = (panel, x, y, r, g, bl) => {
    const i = (y * img.width + panel * (w + gap) + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = bl;
    img.data[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // One source pixel per block keeps it simple; the red panel looks at
      // the whole block so a one-pixel change still shows.
      const s = (y * SCALE * pa.width + x * SCALE) * 4;
      put(0, x, y, pa.data[s], pa.data[s + 1], pa.data[s + 2]);
      put(1, x, y, pb.data[s], pb.data[s + 1], pb.data[s + 2]);
      let hit = false;
      for (let dy = 0; dy < SCALE && !hit; dy++) {
        for (let dx = 0; dx < SCALE && !hit; dx++) {
          hit = mask[(y * SCALE + dy) * pa.width + x * SCALE + dx] === 1;
        }
      }
      if (hit) put(2, x, y, 220, 30, 30);
      else put(2, x, y, 255 - (255 - pb.data[s]) / 4, 255 - (255 - pb.data[s + 1]) / 4, 255 - (255 - pb.data[s + 2]) / 4);
    }
  }
  writeFileSync(join(out, name), PNG.sync.write(img));
}

rows.sort((x, y) => y.share - x.share);
const pct = (s) => `${(s * 100).toFixed(1)}%`.padStart(6);
console.log(`compare: ${a} → ${b}, ${both.length} screens in both`);
for (const r of rows) {
  const label = r.share < UNCHANGED_BELOW ? 'same' : 'changed';
  console.log(`  ${pct(r.share)}  ${label.padEnd(7)}  ${r.name}${r.note ? `  (${r.note})` : ''}`);
}
for (const f of [...before].filter((f) => !after.has(f))) console.log(`  only in ${a}: ${f}`);
for (const f of [...after].filter((f) => !before.has(f))) console.log(`  only in ${b}: ${f}`);
console.log(`compare: side by side (before | after | changed in red) in ${out}`);
