// Turf war: the prisoner's dilemma on a grid. Each cell plays its eight
// neighbours, then copies the best scorer around it.
//   classic:    Nowak & May (1992), pure C and D, temptation b
//   strategies: up to four strategies, payoffs from full matches

import { spatialStep, playMatch, mix, rng } from '../engine.js';
import { getSettings, getStrategy, on } from '../store.js';
import { h, els, actions, fillStrategySelect, color, fitCanvas, pct, FONT_BODY } from '../ui.js';

const TYPE_COLORS = ['lime', 'pink', 'white', 'black'];
const DEFAULT_PICKS = ['tft', 'alld', 'allc', 'pavlov'];

let root;
let $;
let mode = 'classic';
let size = 99;
let grid;
let prev;
let scores;
let gen = 0;
let playing = false;
let raf = 0;
let lastTime = 0;
let acc = 0;
let brush = 1;
let picks = DEFAULT_PICKS.slice();
let pickCount = 3;
let matrix = null;
let census = [];
let off;       // offscreen canvas, one pixel per cell
let rand = rng(1);

export function init(r) {
  root = r;
  $ = els(root);
  off = document.createElement('canvas');
  renderPicks();
  actions(root, {
    'turf-play': () => (playing ? pause() : play()),
    'turf-step': () => { pause(); step(); draw(); },
    'turf-reset': () => start(lastStart[mode]),
    'turf-mode': (v) => setMode(v),
    'turf-start': (v) => start(v),
    'turf-brush': (v) => { brush = Number(v); renderBrushes(); },
    'turf-count': (v) => { pickCount = Number(v); renderPicks(); rebuildMatrix(); start(lastStart.strategies); },
  });
  $.b.addEventListener('input', () => { $['b-label'].textContent = Number($.b.value).toFixed(2); });
  $.mutation.addEventListener('input', () => { $['mut-label'].textContent = `${$.mutation.value}%`; });
  $.size.addEventListener('change', () => { size = Number($.size.value); start(lastStart[mode]); });
  on('settings', () => { matrix = null; if (mode === 'strategies' && !root.hidden) rebuildMatrix(); });
  on('strategies', () => renderPicks());
  on('resize', () => { if (!root.hidden) draw(); });

  let painting = false;
  const paint = (e) => {
    const rect = $.canvas.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - rect.left) / rect.width) * size);
    const cy = Math.floor(((e.clientY - rect.top) / rect.height) * size);
    const rad = size > 120 ? 2 : size > 60 ? 1 : 0;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        grid[y * size + x] = brush;
        prev[y * size + x] = brush;
      }
    }
    draw();
  };
  $.canvas.addEventListener('pointerdown', (e) => {
    painting = true;
    $.canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  $.canvas.addEventListener('pointermove', (e) => { if (painting) paint(e); });
  $.canvas.addEventListener('pointerup', () => { painting = false; });
  $.canvas.addEventListener('pointercancel', () => { painting = false; });

  start('one');
}

export function show() { draw(); }
export function hide() { pause(); }

const lastStart = { classic: 'one', strategies: 'mix' };

function setMode(m) {
  pause();
  mode = m;
  root.querySelectorAll('[data-action="turf-mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === m)));
  $.classic.hidden = m !== 'classic';
  $.strategies.hidden = m !== 'strategies';
  if (m === 'strategies' && !matrix) rebuildMatrix();
  renderBrushes();
  start(lastStart[m]);
}

function types() { return mode === 'classic' ? 2 : pickCount; }

function renderPicks() {
  const rows = [];
  for (let k = 0; k < 4; k++) {
    if (k >= pickCount) break;
    const sel = h('select', { 'aria-label': `Strategy ${k + 1}` });
    fillStrategySelect(sel, { value: picks[k] });
    sel.addEventListener('change', () => {
      picks[k] = sel.value;
      rebuildMatrix();
      draw();
      renderBrushes();
    });
    rows.push(h('div', { class: 'turf-pick' },
      h('span', { class: `swatch swatch--${TYPE_COLORS[k]}${TYPE_COLORS[k] === 'black' ? ' swatch--black-line' : ''}` }),
      h('span', { class: 'select select--dark' }, sel)));
  }
  const counts = h('div', { class: 'chips chips--dark' },
    h('span', { class: 'field__label', text: 'How many' }),
    ...[2, 3, 4].map((n) => h('button', { type: 'button', class: 'chip chip--dark', 'data-action': 'turf-count', 'data-value': String(n), 'aria-pressed': String(n === pickCount), text: String(n) })));
  $.picks.replaceChildren(counts, ...rows);
  renderBrushes();
}

function renderBrushes() {
  if (brush >= types()) brush = types() - 1;
  const labels = mode === 'classic' ? ['Quiet', 'Rat'] : picks.slice(0, pickCount).map((id) => getStrategy(id)?.short || id);
  $.brushes.replaceChildren(...labels.map((label, k) => h('button', {
    type: 'button',
    class: 'chip chip--dark',
    'data-action': 'turf-brush',
    'data-value': String(k),
    'aria-pressed': String(brush === k),
  }, h('span', { class: `swatch swatch--${TYPE_COLORS[k]}${TYPE_COLORS[k] === 'black' ? ' swatch--black-line' : ''}` }), label)));
}

function rebuildMatrix() {
  const s = getSettings();
  const defs = picks.slice(0, pickCount).map((id) => getStrategy(id) || getStrategy('tft'));
  // Average crumbs per round of type a against type b, over a few matches.
  const reps = s.noise > 0 || defs.some((d) => /mix|chance|random/.test(d.source)) ? 3 : 1;
  matrix = defs.map((a) => defs.map((b) => {
    let total = 0;
    for (let r = 0; r < reps; r++) {
      const m = playMatch(a, b, { ...s, randomLength: false, rounds: Math.min(s.rounds, 100) }, { seed: mix(s.seed, 'turf', a.id, b.id, r) });
      total += m.a.score / m.length;
    }
    return total / reps;
  }));
}

function start(kind) {
  pause();
  lastStart[mode] = kind;
  const n = size * size;
  grid = new Uint8Array(n);
  scores = new Float64Array(n);
  rand = rng(mix(getSettings().seed, 'turf', kind, size, Date.now()));
  const mid = Math.floor(size / 2);
  const k = types();
  switch (kind) {
    case 'one': grid[mid * size + mid] = 1; break;
    case 'random': for (let i = 0; i < n; i++) grid[i] = rand() < 0.1 ? 1 : 0; break;
    case 'half': for (let i = 0; i < n; i++) grid[i] = rand() < 0.5 ? 1 : 0; break;
    case 'mix': for (let i = 0; i < n; i++) grid[i] = Math.floor(rand() * k); break;
    case 'blocks':
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const q = (y < mid ? 0 : 2) + (x < mid ? 0 : 1);
          grid[y * size + x] = q % k;
        }
      }
      break;
    case 'invade': {
      // Everyone runs strategy 2; strategy 1 holds a small square in the middle.
      grid.fill(k > 1 ? 1 : 0);
      for (let y = mid - 2; y <= mid + 2; y++) for (let x = mid - 2; x <= mid + 2; x++) grid[y * size + x] = 0;
      break;
    }
    default: break;
  }
  prev = grid.slice();
  gen = 0;
  census = [];
  record();
  if (mode === 'strategies' && !matrix) rebuildMatrix();
  draw();
}

function step() {
  const old = grid;
  if (mode === 'classic') {
    const b = Number($.b.value);
    const pay = (me, other) => (other === 0 ? (me === 0 ? 1 : b) : 0);
    grid = spatialStep(grid, size, pay, scores, { selfInteraction: true });
  } else {
    const M = matrix;
    const pay = (me, other) => M[me][other];
    grid = spatialStep(grid, size, pay, scores, { mutation: Number($.mutation.value) / 100, types: pickCount, rand });
  }
  prev = old;
  gen++;
  record();
}

function record() {
  const counts = new Array(types()).fill(0);
  for (let i = 0; i < grid.length; i++) counts[grid[i]]++;
  census.push(counts.map((c) => c / grid.length));
  if (census.length > 400) census.shift();
}

function play() {
  playing = true;
  $['play-btn'].textContent = 'Pause';
  lastTime = performance.now();
  acc = 0;
  const tick = (now) => {
    const perSec = Number($.speed.value);
    acc += ((now - lastTime) / 1000) * perSec;
    lastTime = now;
    let steps = 0;
    while (acc >= 1 && steps < 4) { step(); acc -= 1; steps++; }
    if (acc > 4) acc = 0;
    if (steps) draw();
    if (playing) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  $['play-btn'].textContent = 'Play';
}

const rgbCache = {};
function rgb(name) {
  if (!rgbCache[name]) {
    const hex = color(name).replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    rgbCache[name] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  return rgbCache[name];
}

function draw() {
  if (!grid) return;
  if (off.width !== size) { off.width = size; off.height = size; }
  const g = off.getContext('2d');
  const img = g.createImageData(size, size);
  const px = img.data;
  const pal = mode === 'classic'
    // prev*2 + now: stayed quiet, turned rat, turned quiet, stayed rat
    ? [rgb('lime'), rgb('black'), rgb('white'), rgb('pink')]
    : TYPE_COLORS.map(rgb);
  for (let i = 0; i < grid.length; i++) {
    const c = mode === 'classic' ? pal[prev[i] * 2 + grid[i]] : pal[grid[i]];
    const o = i * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  const cssW = $.canvas.clientWidth;
  const { ctx } = fitCanvas($.canvas, cssW);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, cssW, cssW);

  $.gen.textContent = `Gen ${gen}`;
  const now = census[census.length - 1] || [];
  const names = mode === 'classic' ? ['Quiet', 'Rats'] : picks.slice(0, pickCount).map((id) => getStrategy(id)?.name || id);
  $.census.textContent = names.map((n, k) => `${n} ${pct(now[k] || 0)}`).join(' · ');
  drawSpark();
}

function drawSpark() {
  const { ctx, w, h: hh } = fitCanvas($.spark, 90);
  ctx.clearRect(0, 0, w, hh);
  ctx.strokeStyle = color('white');
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, hh - 1);
  ctx.globalAlpha = 1;
  if (census.length < 2) return;
  const k = types();
  const xs = (i) => (i / Math.max(1, census.length - 1)) * (w - 4) + 2;
  const ys = (v) => hh - 4 - v * (hh - 8);
  for (let t = 0; t < k; t++) {
    const name = TYPE_COLORS[t];
    ctx.strokeStyle = color(name === 'black' ? 'white' : name);
    ctx.setLineDash(name === 'black' ? [3, 3] : name === 'white' ? [1, 0] : []);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    census.forEach((c, i) => (i ? ctx.lineTo(xs(i), ys(c[t])) : ctx.moveTo(xs(i), ys(c[t]))));
    ctx.stroke();
    if (mode === 'classic') break;   // the rat line is just 1 minus this one
  }
  ctx.setLineDash([]);
  ctx.font = `600 10px ${FONT_BODY}`;
  ctx.fillStyle = color('white');
  ctx.fillText(mode === 'classic' ? 'share keeping quiet' : 'share of the grid', 6, 13);
}
