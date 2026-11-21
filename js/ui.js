// Small DOM helpers shared by the views. Text always goes in through textContent,
// never innerHTML: strategy names can come from share links.

import { allStrategies } from './store.js';
import { highlightTokens } from './lang.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// Elements inside a view are found by data-el.
export function els(root) {
  const map = {};
  root.querySelectorAll('[data-el]').forEach((el) => { map[el.dataset.el] = el; });
  return map;
}

// One click handler per view, keyed by data-action.
export function actions(root, handlers) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !root.contains(btn)) return;
    const fn = handlers[btn.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(btn.dataset.value, btn, e);
    }
  });
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '–');
export const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
// Scores are whole crumbs unless noise or odd payoffs say otherwise.
export const crumbs = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

let toastTimer = 0;
export function toast(message) {
  const el = document.querySelector('[data-el="toast"]');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// Fills a <select> with every strategy, grouped. Keeps the current value if it still exists.
export function fillStrategySelect(select, { value, extra = [] } = {}) {
  const current = value ?? select.value;
  select.replaceChildren();
  for (const e of extra) select.append(h('option', { value: e.value, text: e.label }));
  const all = allStrategies();
  const groups = [
    ['Classics', all.filter((s) => s.builtin)],
    ['Yours', all.filter((s) => !s.builtin)],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const g = h('optgroup', { label });
    list.forEach((s) => g.append(h('option', { value: s.id, text: s.name })));
    select.append(g);
  }
  if ([...select.options].some((o) => o.value === current)) select.value = current;
  return select.value;
}

// ---------------------------------------------------------------- fills
// Charts need up to two dozen distinguishable series and the brand has four
// colours. So: colour + print-style pattern, like a riso zine.

const MOTIFS = ['solid', 'diag', 'dots', 'cross', 'hlines', 'checks'];
const PAIRS = [
  ['black', 'black'], ['pink', 'pink'], ['lime', 'lime'], ['white', 'white'],
  ['white', 'pink'], ['lime', 'black'], ['black', 'lime'], ['pink', 'white'],
  ['white', 'black'], ['black', 'pink'], ['pink', 'black'], ['lime', 'pink'],
  ['black', 'white'], ['pink', 'lime'], ['white', 'lime'], ['lime', 'white'],
];

const FILLS = (() => {
  const list = [];
  for (let i = 0; i < 4; i++) list.push({ bg: PAIRS[i][0], ink: PAIRS[i][1], motif: 'solid' });
  let k = 0;
  for (let m = 1; m < MOTIFS.length; m++) {
    for (let p = 4; p < PAIRS.length; p++) {
      list.push({ bg: PAIRS[p][0], ink: PAIRS[p][1], motif: MOTIFS[(m + k++) % (MOTIFS.length - 1) + 1] });
    }
  }
  return list;
})();

function fillSpec(index) { return FILLS[((index % FILLS.length) + FILLS.length) % FILLS.length]; }

const COLORS = {};
export function color(name) {
  COLORS[name] ||= css(`--${name}`);
  return COLORS[name];
}

const patternCache = new Map();
function tileFor(spec, scale) {
  const key = `${spec.bg}/${spec.ink}/${spec.motif}/${scale}`;
  if (patternCache.has(key)) return patternCache.get(key);
  const s = Math.round(8 * scale);
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = color(spec.bg);
  g.fillRect(0, 0, s, s);
  g.fillStyle = color(spec.ink);
  g.strokeStyle = color(spec.ink);
  g.lineWidth = 1.6 * scale;
  switch (spec.motif) {
    case 'diag':
      g.beginPath();
      g.moveTo(-1, s + 1); g.lineTo(s + 1, -1);
      g.moveTo(-1, 1); g.lineTo(1, -1);
      g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1);
      g.stroke();
      break;
    case 'dots':
      g.beginPath();
      g.arc(s / 2, s / 2, 1.6 * scale, 0, Math.PI * 2);
      g.fill();
      break;
    case 'cross':
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(s, s);
      g.moveTo(s, 0); g.lineTo(0, s);
      g.stroke();
      break;
    case 'hlines':
      g.fillRect(0, s / 2 - scale, s, 2 * scale);
      break;
    case 'checks':
      g.fillRect(0, 0, s / 2, s / 2);
      g.fillRect(s / 2, s / 2, s / 2, s / 2);
      break;
    default: break;
  }
  patternCache.set(key, c);
  return c;
}

export function fillStyle(ctx, index, scale = 1) {
  const spec = fillSpec(index);
  if (spec.motif === 'solid') return color(spec.bg);
  return ctx.createPattern(tileFor(spec, scale), 'repeat');
}

// A small square showing a strategy's fill, for legends.
export function swatch(index, size = 16) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { class: 'fill-swatch', width: size * dpr, height: size * dpr, 'aria-hidden': 'true' });
  c.style.setProperty('--size', `${size}px`);
  const g = c.getContext('2d');
  g.fillStyle = fillStyle(g, index, dpr);
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Sets a canvas's backing store to its CSS size times the pixel ratio.
export function fitCanvas(canvas, cssHeight) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, canvas.clientWidth);
  const hgt = cssHeight ?? canvas.clientHeight;
  if (cssHeight !== undefined) canvas.style.setProperty('--h', `${cssHeight}px`);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hgt, dpr };
}

export const FONT_BODY = '"Work Sans", system-ui, sans-serif';
export const FONT_DISPLAY = 'Anton, sans-serif';

// Horizontal bars. rows: [{ label, value, fill, highlight, sub }]
export function barList(container, rows, { max, format = (v) => fmt(v) } = {}) {
  const top = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  container.replaceChildren(...rows.map((r) => {
    const bar = h('span', { class: 'bar__fill' });
    bar.style.setProperty('--w', `${Math.max(0, Math.min(100, (r.value / top) * 100)).toFixed(1)}%`);
    return h('div', { class: `bar${r.highlight ? ' bar--you' : ''}` },
      h('span', { class: 'bar__label' }, r.fill !== undefined ? swatch(r.fill, 12) : null, h('span', { text: r.label })),
      h('span', { class: 'bar__track' }, bar),
      h('span', { class: 'bar__value', text: format(r.value) }),
      r.sub ? h('span', { class: 'bar__sub', text: r.sub }) : null);
  }));
}

// Syntax-highlighted source, built from spans.
export function renderCode(target, src) {
  const frag = document.createDocumentFragment();
  for (const t of highlightTokens(src)) {
    if (t.type === 'plain' || t.type === 'op') frag.append(t.text);
    else frag.append(h('span', { class: `tok tok--${t.type}`, text: t.text }));
  }
  target.replaceChildren(frag);
}
