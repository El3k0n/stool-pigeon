// Renders docs/kaleidoscope.png, the animation in the README: one defector in a
// field of cooperators, Nowak–May rules, b = 1.85. It runs the same spatialStep
// as the Turf war page and writes an animated PNG by hand (zlib is all it needs).
//
//   node dev/kaleidoscope.mjs [out.png]

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { spatialStep } from '../js/engine.js';

const OUT = process.argv[2] || 'docs/kaleidoscope.png';
const SIZE = 99;          // cells per side, odd so there is a middle
const CELL = 5;           // pixels per cell
const GENERATIONS = 90;
const POSTER = 30;        // the still shown where APNG doesn't animate
const B = 1.85;

// The four brand colours, straight from the stylesheet.
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const token = (name) => {
  const hex = new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i').exec(css)[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};
// Palette index = previous * 2 + current: stayed quiet, turned rat, turned quiet, stayed rat.
const palette = [token('lime'), token('black'), token('white'), token('pink')];

let grid = new Uint8Array(SIZE * SIZE);
grid[(SIZE * SIZE - 1) / 2] = 1;
const scores = new Float64Array(grid.length);
const pay = (me, other) => (other === 0 ? (me === 0 ? 1 : B) : 0);

const frames = [];
let prev = grid;
for (let g = 0; g <= GENERATIONS; g++) {
  frames.push(render(prev, grid));
  prev = grid;
  grid = spatialStep(grid, SIZE, pay, scores, { selfInteraction: true });
}

function render(before, now) {
  const w = SIZE * CELL;
  const rows = Buffer.alloc((w + 1) * w);
  for (let y = 0; y < w; y++) {
    const row = y * (w + 1);
    rows[row] = 0;   // filter: none
    for (let x = 0; x < w; x++) {
      const i = Math.floor(y / CELL) * SIZE + Math.floor(x / CELL);
      rows[row + 1 + x] = before[i] * 2 + now[i];
    }
  }
  return deflateSync(rows, { level: 9 });
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const u32 = (...values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v, i * 4));
  return b;
};

const width = SIZE * CELL;
const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])];
parts.push(chunk('IHDR', Buffer.concat([u32(width, width), Buffer.from([8, 3, 0, 0, 0])])));
parts.push(chunk('PLTE', Buffer.from(palette.flat())));
parts.push(chunk('acTL', u32(frames.length, 0)));
// The default image comes before the first fcTL, so it isn't part of the animation:
// viewers that can't animate show a busy generation instead of a lone dot.
parts.push(chunk('IDAT', frames[POSTER]));
let seq = 0;
frames.forEach((data, i) => {
  // fcTL: sequence, size, offset, delay (ms/1000), dispose none, blend source
  const delay = i === frames.length - 1 ? 2500 : i === 0 ? 900 : 110;
  const fctl = Buffer.alloc(26);
  fctl.writeUInt32BE(seq++, 0);
  fctl.writeUInt32BE(width, 4);
  fctl.writeUInt32BE(width, 8);
  fctl.writeUInt16BE(delay, 20);
  fctl.writeUInt16BE(1000, 22);
  parts.push(chunk('fcTL', fctl));
  parts.push(chunk('fdAT', Buffer.concat([u32(seq++), data])));
});
parts.push(chunk('IEND', Buffer.alloc(0)));
writeFileSync(OUT, Buffer.concat(parts));
console.log(`${OUT}: ${frames.length} frames, ${width}×${width}`);
