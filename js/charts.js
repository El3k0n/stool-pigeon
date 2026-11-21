// Hand-rolled charts: canvas for the busy ones, SVG for the radar.
// Flat colours, black axes, no blur. Same look as the rest of the site.

import { color, fillStyle, fitCanvas, svg, FONT_BODY, FONT_DISPLAY } from './ui.js';

const PAD = { l: 44, r: 14, t: 14, b: 30 };

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function axes(ctx, w, h, { xMax, yMax, yMin = 0, xLabel, yTicks = 4, yFormat = (v) => v, xTicks = 5 }) {
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  ctx.font = `600 11px ${FONT_BODY}`;
  ctx.fillStyle = color('black');
  ctx.strokeStyle = color('black');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = PAD.t + ih - (ih * i) / yTicks;
    ctx.globalAlpha = i === 0 ? 1 : 0.15;
    ctx.beginPath();
    ctx.moveTo(PAD.l, Math.round(y) + 0.5);
    ctx.lineTo(PAD.l + iw, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(yFormat(v), PAD.l - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i <= xTicks; i++) {
    const v = Math.round((xMax * i) / xTicks);
    ctx.fillText(String(v), PAD.l + (iw * v) / Math.max(1, xMax), PAD.t + ih + 6);
  }
  if (xLabel) {
    ctx.textAlign = 'right';
    ctx.fillText(xLabel, PAD.l + iw, PAD.t + ih + 18);
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD.l, PAD.t);
  ctx.lineTo(PAD.l, PAD.t + ih);
  ctx.lineTo(PAD.l + iw, PAD.t + ih);
  ctx.stroke();
  return { iw, ih, x: (v) => PAD.l + (iw * v) / Math.max(1, xMax), y: (v) => PAD.t + ih - (ih * (v - yMin)) / (yMax - yMin || 1) };
}

// series: [{ values: number[], color, width, dash }]
export function lineChart(canvas, { series, xMax, yMax, xLabel, height = 260, upto, yFormat }) {
  const { ctx, w, h } = fitCanvas(canvas, height);
  ctx.clearRect(0, 0, w, h);
  const top = niceMax(yMax ?? Math.max(1, ...series.flatMap((s) => s.values)));
  const ax = axes(ctx, w, h, { xMax, yMax: top, xLabel, yFormat });
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of series) {
    const n = Math.min(upto ?? s.values.length, s.values.length);
    if (n < 1) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 3;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    ctx.moveTo(ax.x(0), ax.y(0));
    for (let i = 0; i < n; i++) ctx.lineTo(ax.x(i + 1), ax.y(s.values[i]));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return ax;
}

// Stacked shares (each row of `history` sums to 1). fills: fill index per series.
export function stackedArea(canvas, { history, fills, height = 380, total, hover }) {
  const { ctx, w, h, dpr } = fitCanvas(canvas, height);
  ctx.clearRect(0, 0, w, h);
  const xMax = Math.max(1, (total ?? history.length) - 1);
  const ax = axes(ctx, w, h, { xMax, yMax: 1, xLabel: 'generation', yFormat: (v) => `${Math.round(v * 100)}%` });
  const n = fills.length;
  const g = history.length;
  if (g < 1) return ax;
  const step = Math.max(1, Math.floor(g / (ax.iw * 1.5)));
  const idx = [];
  for (let i = 0; i < g; i += step) idx.push(i);
  if (idx[idx.length - 1] !== g - 1) idx.push(g - 1);

  const lower = new Float64Array(idx.length);
  for (let s = 0; s < n; s++) {
    const upper = idx.map((gi, k) => lower[k] + history[gi][s]);
    if (upper.some((u, k) => u - lower[k] > 1e-6)) {
      ctx.beginPath();
      idx.forEach((gi, k) => (k ? ctx.lineTo(ax.x(gi), ax.y(upper[k])) : ctx.moveTo(ax.x(gi), ax.y(upper[k]))));
      for (let k = idx.length - 1; k >= 0; k--) ctx.lineTo(ax.x(idx[k]), ax.y(lower[k]));
      ctx.closePath();
      ctx.fillStyle = fillStyle(ctx, fills[s], dpr);
      ctx.fill();
      ctx.strokeStyle = color('black');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      idx.forEach((gi, k) => (k ? ctx.lineTo(ax.x(gi), ax.y(upper[k])) : ctx.moveTo(ax.x(gi), ax.y(upper[k]))));
      ctx.stroke();
    }
    upper.forEach((u, k) => { lower[k] = u; });
  }
  if (hover !== undefined && hover !== null && hover < g) {
    const x = Math.round(ax.x(hover)) + 0.5;
    ctx.strokeStyle = color('black');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, PAD.t + ax.ih);
    ctx.stroke();
  }
  return ax;
}

export function xToIndex(canvas, clientX, xMax) {
  const r = canvas.getBoundingClientRect();
  const iw = r.width - PAD.l - PAD.r;
  const v = Math.round(((clientX - r.left - PAD.l) / iw) * xMax);
  return Math.max(0, Math.min(xMax, v));
}

// Five-axis radar. traits: [{ label, value 0..1 }]. compare: optional second set.
export function radar(traits, { size = 260, compare } = {}) {
  const cx = size / 2;
  const cy = size / 2 + 4;
  const r = size / 2 - 46;
  const n = traits.length;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
  };
  const poly = (vals) => vals.map((v, i) => pt(i, Math.max(0.03, v)).map((x) => x.toFixed(1)).join(',')).join(' ');
  const root = svg('svg', { class: 'radar', viewBox: `-56 -4 ${size + 112} ${size + 8}`, role: 'img', 'aria-label': traits.map((t) => `${t.label} ${Math.round(t.value * 100)}%`).join(', ') });
  for (const ring of [1 / 3, 2 / 3, 1]) {
    root.append(svg('polygon', { class: ring === 1 ? 'radar__ring radar__ring--outer' : 'radar__ring', points: poly(traits.map(() => ring)) }));
  }
  traits.forEach((t, i) => {
    const [x, y] = pt(i, 1);
    root.append(svg('line', { class: 'radar__spoke', x1: cx, y1: cy, x2: x, y2: y }));
    const [lx, ly] = pt(i, 1.2);
    root.append(svg('text', { class: 'radar__label', x: lx.toFixed(1), y: (ly + 4).toFixed(1), 'text-anchor': Math.abs(lx - cx) < 8 ? 'middle' : lx < cx ? 'end' : 'start', text: t.label }));
  });
  if (compare) root.append(svg('polygon', { class: 'radar__shape radar__shape--ghost', points: poly(compare.map((t) => t.value)) }));
  root.append(svg('polygon', { class: 'radar__shape', points: poly(traits.map((t) => t.value)) }));
  traits.forEach((t, i) => {
    const [x, y] = pt(i, Math.max(0.03, t.value));
    root.append(svg('rect', { class: 'radar__dot', x: (x - 4).toFixed(1), y: (y - 4).toFixed(1), width: 8, height: 8 }));
  });
  return root;
}

// The duel tape: blocks of `perRow` rounds, two rows each (A on top, B below).
export function tape(canvas, match, { upto, perRow: wanted, highlight } = {}) {
  const width = Math.max(10, canvas.clientWidth);
  const total = match.length;
  // Rows hold a round number of rounds (50 on a laptop), cells at least 14px when the match is short.
  const room = width - 40;
  const minCell = total > 300 ? 6 : 14;
  const perRow = wanted || Math.min(total, [200, 100, 50, 40, 25, 20, 10].find((c) => room / c >= minCell) || 10);
  const cell = Math.max(4, Math.min(22, Math.floor(room / perRow)));
  const rows = Math.ceil(total / perRow);
  const blockH = cell * 2 + 12;
  const height = rows * blockH + 6;
  const { ctx, w, h } = fitCanvas(canvas, height);
  ctx.clearRect(0, 0, w, h);
  const shown = Math.min(upto ?? match.round, match.round);
  ctx.font = `400 ${Math.min(14, cell + 2)}px ${FONT_DISPLAY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const geo = { perRow, cell, blockH, left: 30, top: 3 };
  for (let r = 0; r < rows; r++) {
    const y0 = 3 + r * blockH;
    ctx.fillStyle = color('black');
    ctx.fillText('A', 4, y0 + cell / 2);
    ctx.fillText('B', 4, y0 + cell * 1.5 + 2);
    for (let k = 0; k < perRow; k++) {
      const i = r * perRow + k;
      if (i >= total) break;
      const x = 30 + k * cell;
      for (const side of [0, 1]) {
        const y = y0 + side * (cell + 2);
        if (i >= shown) {
          ctx.strokeStyle = color('black');
          ctx.globalAlpha = 0.15;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cell - 2, cell - 1);
          ctx.globalAlpha = 1;
          continue;
        }
        const hist = side ? match.b : match.a;
        const flips = side ? match.flipsB : match.flipsA;
        ctx.fillStyle = hist.m[i] ? color('pink') : color('lime');
        ctx.fillRect(x, y, cell - 1, cell);
        if (cell >= 7) {
          ctx.strokeStyle = color('black');
          ctx.lineWidth = cell >= 12 ? 2 : 1;
          ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, cell - 1 - ctx.lineWidth, cell - ctx.lineWidth);
        } else if (hist.m[i]) {
          ctx.fillStyle = color('black');
          ctx.fillRect(x, y + cell - 1, cell - 1, 1);
        }
        if (flips[i]) {
          ctx.strokeStyle = color('black');
          ctx.lineWidth = Math.max(1.5, cell / 7);
          ctx.beginPath();
          ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + cell - 3, y + cell - 2);
          ctx.moveTo(x + cell - 3, y + 2); ctx.lineTo(x + 2, y + cell - 2);
          ctx.stroke();
        }
      }
      if (highlight === i) {
        ctx.strokeStyle = color('black');
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 2, y0 - 2, cell + 3, cell * 2 + 6);
      }
    }
  }
  return geo;
}

export function tapeIndexAt(geo, canvas, clientX, clientY, total) {
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left - geo.left;
  const y = clientY - r.top - geo.top;
  if (x < 0 || y < 0) return -1;
  const k = Math.floor(x / geo.cell);
  const row = Math.floor(y / geo.blockH);
  if (k >= geo.perRow) return -1;
  const i = row * geo.perRow + k;
  return i < total ? i : -1;
}
