// Duel: two strategies, one match, every move on tape.

import { Match, mix } from '../engine.js';
import { getSettings, getStrategy, on } from '../store.js';
import { h, els, actions, fillStrategySelect, color, fmt, pct, crumbs } from '../ui.js';
import { lineChart, tape, tapeIndexAt } from '../charts.js';

let root;
let $;
let match = null;
let shown = 0;
let reseed = 0;
let anim = 0;
let geo = null;
let hover = -1;
let cumA = [];
let cumB = [];

export function init(r) {
  root = r;
  $ = els(root);
  fillStrategySelect($.a, { value: 'tft' });
  fillStrategySelect($.b, { value: 'joss' });
  on('strategies', () => {
    fillStrategySelect($.a);
    fillStrategySelect($.b);
  });
  $.a.addEventListener('change', () => compute(true));
  $.b.addEventListener('change', () => compute(true));
  actions(root, {
    'duel-swap': () => {
      [$.a.value, $.b.value] = [$.b.value, $.a.value];
      compute(true);
    },
    'duel-play': () => (anim ? stop() : animate()),
    'duel-instant': () => { stop(); shown = match.length; draw(); },
    'duel-reseed': () => { reseed++; compute(true); },
  });
  on('settings', () => { if (!root.hidden) compute(false); else match = null; });
  on('resize', () => { if (!root.hidden) draw(); });

  $.tape.addEventListener('pointermove', (e) => {
    if (!geo || !match) return;
    const i = tapeIndexAt(geo, $.tape, e.clientX, e.clientY, match.length);
    if (i !== hover) {
      hover = i < shown ? i : -1;
      draw();
    }
    if (hover >= 0) {
      $['tape-tip'].style.setProperty('--x', `${Math.min(window.innerWidth - 276, e.clientX + 14)}px`);
      $['tape-tip'].style.setProperty('--y', `${e.clientY + 18}px`);
    }
  });
  $.tape.addEventListener('pointerleave', () => { hover = -1; draw(); });
}

export function show(params) {
  const a = params.get('a');
  const b = params.get('b');
  let changed = false;
  if (a && getStrategy(a)) { fillStrategySelect($.a, { value: a }); changed = true; }
  if (b && getStrategy(b)) { fillStrategySelect($.b, { value: b }); changed = true; }
  if (changed || !match) compute(changed);
  else draw();
}

export function hide() { stop(); }

function compute(play) {
  stop();
  const A = getStrategy($.a.value);
  const B = getStrategy($.b.value);
  if (!A || !B) return;
  const s = getSettings();
  match = new Match(A, B, s, { seed: mix(s.seed, 'duel', A.id, B.id, reseed) }).run();
  cumA = [];
  cumB = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < match.length; i++) {
    x += match.a.pay[i];
    y += match.b.pay[i];
    cumA.push(x);
    cumB.push(y);
  }
  $['name-a'].textContent = A.name;
  $['name-b'].textContent = B.name;
  const errs = [[A, match.errors[0]], [B, match.errors[1]]].filter(([, e]) => e);
  $.error.hidden = !errs.length;
  $.error.textContent = errs.map(([s, e]) => `${s.name} crashed on line ${e.line}: ${e.message}. It kept quiet from then on.`).join(' ');
  if (play) animate();
  else { shown = match.length; draw(); }
}

function animate() {
  stop();
  if (shown >= match.length) shown = 0;
  const perFrame = Math.max(1 / 6, match.length / 240);   // about four seconds, never faster than 10 rounds a second
  let acc = shown;
  $['play-btn'].textContent = 'Pause';
  const tick = () => {
    acc += perFrame;
    shown = Math.min(match.length, Math.floor(acc));
    draw();
    if (shown < match.length) anim = requestAnimationFrame(tick);
    else stop();
  };
  anim = requestAnimationFrame(tick);
}

function stop() {
  if (anim) cancelAnimationFrame(anim);
  anim = 0;
  $['play-btn'].textContent = 'Play';
}

function draw() {
  if (!match) return;
  const n = shown;
  const sa = n ? cumA[n - 1] : 0;
  const sb = n ? cumB[n - 1] : 0;
  $['score-a'].textContent = crumbs(sa);
  $['score-b'].textContent = crumbs(sb);
  $.round.textContent = `${n} / ${match.length}`;
  let coopA = 0;
  let coopB = 0;
  const out = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!match.a.m[i]) coopA++;
    if (!match.b.m[i]) coopB++;
    out[match.a.m[i] * 2 + match.b.m[i]]++;
  }
  $['sub-a'].textContent = n ? `${fmt(sa / n)} a round · quiet ${pct(coopA / n)}` : '';
  $['sub-b'].textContent = n ? `${fmt(sb / n)} a round · quiet ${pct(coopB / n)}` : '';
  $.verdict.textContent = n === match.length ? verdict(out, sa, sb, n) : '';

  geo = tape($.tape, match, { upto: n, highlight: hover });
  const tip = $['tape-tip'];
  if (hover >= 0 && hover < n) {
    const word = (m) => (m ? 'rats' : 'keeps quiet');
    const flipped = (f) => (f ? ' (noise flipped it)' : '');
    tip.textContent = `Round ${hover + 1}: ${$['name-a'].textContent} ${word(match.a.m[hover])}${flipped(match.flipsA[hover])}, +${crumbs(match.a.pay[hover])}. ${$['name-b'].textContent} ${word(match.b.m[hover])}${flipped(match.flipsB[hover])}, +${crumbs(match.b.pay[hover])}.`;
    tip.hidden = false;
  } else tip.hidden = true;

  const { R, P } = match.payoff;
  lineChart($.chart, {
    xMax: match.length,
    yMax: Math.max(R * match.length, cumA.at(-1), cumB.at(-1)),
    xLabel: 'round',
    upto: n,
    series: [
      { values: cumA.map((_, i) => R * (i + 1)), color: color('black'), width: 1, dash: [4, 4] },
      { values: cumA.map((_, i) => P * (i + 1)), color: color('black'), width: 1, dash: [1, 4] },
      { values: cumA, color: color('black'), width: 4 },
      { values: cumB, color: color('pink'), width: 4 },
    ],
  });
  $['chart-legend'].replaceChildren(
    h('span', { class: 'legend__item' }, h('span', { class: 'legend__line' }), $['name-a'].textContent),
    h('span', { class: 'legend__item' }, h('span', { class: 'legend__line legend__line--pink' }), $['name-b'].textContent),
    h('span', { class: 'legend__item' }, h('span', { class: 'legend__line legend__line--dash' }), 'always both quiet'),
    h('span', { class: 'legend__item' }, h('span', { class: 'legend__line legend__line--dot' }), 'always both rat'),
  );

  const names = [$['name-a'].textContent, $['name-b'].textContent];
  const cells = [
    ['cc', 'Both quiet', out[0]],
    ['cd', `${names[1]} rats`, out[1]],
    ['dc', `${names[0]} rats`, out[2]],
    ['dd', 'Both rat', out[3]],
  ];
  $.outcomes.replaceChildren(...cells.map(([k, label, count]) => h('div', { class: `outcome outcome--${k}` },
    h('span', { class: 'outcome__num', text: String(count) }),
    h('span', { class: 'outcome__label', text: label }),
    h('span', { class: 'outcome__pct', text: n ? pct(count / n) : '' }))));
}


function verdict([cc, cd, dc, dd], sa, sb, n) {
  const A = $['name-a'].textContent;
  const B = $['name-b'].textContent;
  if (cc / n > 0.9) return 'Friends for life. Boring. Profitable.';
  if (dd / n > 0.8) return 'Two rats in a cage. Everybody starves.';
  if ((cd + dc) / n > 0.5 && Math.min(cd, dc) / n > 0.2) return 'Stuck in a revenge loop. Nobody remembers who started it.';
  const diff = (sa - sb) / Math.max(1, Math.max(sa, sb));
  if (diff > 0.15) return `${A} milked ${B}.`;
  if (diff < -0.15) return `${B} milked ${A}.`;
  if (cc / n > 0.6) return 'Mostly civil. Some incidents.';
  return 'Messy. Like most relationships.';
}
