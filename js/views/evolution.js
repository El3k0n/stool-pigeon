// Evolution: replicator dynamics on the tournament's payoff matrix.

import { replicator, rng, mix } from '../engine.js';
import { DEFAULT_LINEUP } from '../strategies.js';
import { getSettings, allStrategies, getLastTournament, setLastTournament, on } from '../store.js';
import { h, els, actions, swatch, pct, toast } from '../ui.js';
import { stackedArea, xToIndex } from '../charts.js';
import { runTournament } from '../runner.js';

let root;
let $;
let pool = null;       // { defs, result, settings }
let history = [];
let shown = 0;
let anim = 0;
let hover = null;
let busy = false;

export function init(r) {
  root = r;
  $ = els(root);
  $.start.addEventListener('change', () => {
    $['invader-field'].hidden = $.start.value !== 'invade';
    compute(true);
  });
  $.invader.addEventListener('change', () => compute(true));
  $.source.addEventListener('change', () => load(true));
  $.gens.addEventListener('change', () => compute(true));
  $.mutation.addEventListener('input', () => {
    $['mut-label'].textContent = `${$.mutation.value}%`;
  });
  $.mutation.addEventListener('change', () => compute(true));
  actions(root, {
    'evo-run': () => (anim ? stop() : animate()),
    'evo-instant': () => { stop(); shown = history.length; draw(); },
  });
  // A tournament run elsewhere replaces the population (not the one this view just ran itself).
  on('tournament', (t) => {
    if (t === pool || $.source.value !== 'tournament') return;
    pool = null;
    if (!root.hidden) load(false);
  });
  on('settings', () => { pool = null; if (!root.hidden) load(false); });
  on('resize', () => { if (!root.hidden) draw(); });

  $.chart.addEventListener('pointermove', (e) => {
    if (!history.length) return;
    hover = Math.min(shown - 1, xToIndex($.chart, e.clientX, Math.max(1, history.length - 1)));
    draw();
  });
  $.chart.addEventListener('pointerleave', () => { hover = null; draw(); });
}

export function show() {
  if (!pool) load(true);
  else draw();
}

export function hide() { stop(); }

async function load(play) {
  if (busy) return;
  const last = getLastTournament();
  const settings = getSettings();
  const fresh = last && JSON.stringify(last.settings) === JSON.stringify(settings);
  if ($.source.value === 'tournament' && fresh) {
    pool = last;
  } else {
    // No usable tournament: run the default lineup (or the old entrants) under the current rules.
    const ids = $.source.value === 'tournament' && last ? last.defs.map((d) => d.id) : DEFAULT_LINEUP;
    const all = allStrategies();
    const defs = ids.map((id) => all.find((s) => s.id === id)).filter(Boolean);
    busy = true;
    $.insight.textContent = 'Running the tournament first…';
    try {
      const result = await runTournament(defs, settings);
      pool = { defs, result, settings };
      if ($.source.value === 'tournament') setLastTournament(pool);
    } catch (err) {
      toast(`Could not run the tournament: ${err.message}`);
      return;
    } finally {
      busy = false;
    }
  }
  const sel = $.invader.value;
  $.invader.replaceChildren(...pool.defs.map((d) => h('option', { value: d.id, text: d.name })));
  if (pool.defs.some((d) => d.id === sel)) $.invader.value = sel;
  else if (pool.defs.some((d) => d.id === 'tft')) $.invader.value = 'tft';
  compute(play);
}

function share(s) {
  if (s.share === 0) return s.died !== null ? `extinct, gen ${s.died}` : 'extinct';
  if (s.share < 0.001) return '<0.1%';
  return pct(s.share, s.share < 0.01 ? 1 : 0);
}

function startShares() {
  const n = pool.defs.length;
  const ids = pool.defs.map((d) => d.id);
  switch ($.start.value) {
    case 'random': {
      const r = rng(mix(getSettings().seed, 'evo-start'));
      return ids.map(() => 0.05 + r());
    }
    case 'rats': {
      const k = ids.indexOf('alld');
      if (k < 0) { toast('Always Defect is not in this population.'); return ids.map(() => 1); }
      return ids.map((_, i) => (i === k ? 0.9 : 0.1 / (n - 1)));
    }
    case 'invade': {
      const k = ids.indexOf($.invader.value);
      return ids.map((_, i) => (i === k ? 0.01 : 0.99 / (n - 1)));
    }
    default: return ids.map(() => 1);
  }
}

function compute(play) {
  if (!pool) return;
  stop();
  const gens = Math.max(10, Math.min(2000, Number($.gens.value) || 300));
  history = replicator(pool.result.score, startShares(), gens, { mutation: Number($.mutation.value) / 100 });
  hover = null;
  if (play) animate();
  else { shown = history.length; draw(); }
}

function animate() {
  stop();
  if (shown >= history.length) shown = 1;
  const per = Math.max(0.5, history.length / 200);
  let acc = shown;
  $.run.textContent = 'Pause';
  const tick = () => {
    acc += per;
    shown = Math.min(history.length, Math.floor(acc));
    draw();
    if (shown < history.length) anim = requestAnimationFrame(tick);
    else stop();
  };
  anim = requestAnimationFrame(tick);
}

function stop() {
  if (anim) cancelAnimationFrame(anim);
  anim = 0;
  $.run.textContent = 'Evolve';
}

function draw() {
  if (!pool || !history.length) return;
  const defs = pool.defs;
  const visible = history.slice(0, Math.max(1, shown));
  stackedArea($.chart, { history: visible, fills: defs.map((d) => d.fill), total: history.length, hover });
  const g = hover ?? visible.length - 1;
  $.gen.textContent = `Generation ${g} of ${history.length - 1}`;
  const now = history[g];

  // Census: when each strategy peaked and when it died, over what has been shown.
  const stats = defs.map((d, i) => {
    let peak = 0;
    let peakGen = 0;
    let died = null;
    for (let k = 0; k < visible.length; k++) {
      const v = visible[k][i];
      if (v > peak) { peak = v; peakGen = k; }
      if (died === null && v === 0 && k > 0) died = k;
      if (v > 0) died = null;
    }
    return { d, i, share: now[i], peak, peakGen, died };
  });
  stats.sort((a, b) => b.share - a.share || b.peak - a.peak);
  $.census.replaceChildren(...stats.map((s) => {
    const bar = h('span', { class: 'census__fill' });
    bar.style.setProperty('--w', `${(s.share * 100).toFixed(1)}%`);
    return h('li', { class: `census__row${s.share === 0 ? ' census__row--dead' : ''}` },
      swatch(s.d.fill, 14),
      h('span', { class: 'census__name', text: s.d.name }),
      h('span', { class: 'census__share', text: share(s) }),
      h('span', { class: 'census__track' }, bar));
  }));

  if (shown >= history.length && hover === null) {
    const alive = stats.filter((s) => s.share > 0);
    const lead = alive.slice(0, 3).map((s) => `${s.d.name} ${pct(s.share)}`).join(', ');
    const parts = [`After ${history.length - 1} generations: ${lead}.`];
    const bust = stats.filter((s) => s.share === 0 && s.peakGen > 0 && s.peak > now.length ** -1 * 1.2)
      .sort((a, b) => b.peak - a.peak)[0];
    if (bust) parts.push(`${bust.d.name} boomed to ${pct(bust.peak)} in generation ${bust.peakGen}, then ran out of suckers and died out in generation ${bust.died}.`);
    else if (alive.length === 1) parts.push('Nobody else made it.');
    const dead = stats.filter((s) => s.share === 0).length;
    if (dead && !bust) parts.push(`${dead} strateg${dead === 1 ? 'y' : 'ies'} died out.`);
    $.insight.textContent = parts.join(' ');
  } else if (hover === null) {
    $.insight.textContent = '';
  }
}
