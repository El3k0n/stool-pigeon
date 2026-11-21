// Tournament: a round robin, ranked by average crumbs per round.

import { DEFAULT_LINEUP } from '../strategies.js';
import { getSettings, setSettings, allStrategies, on, setLastTournament, getLastTournament } from '../store.js';
import { h, els, actions, swatch, fmt, pct, toast } from '../ui.js';
import { runTournament } from '../runner.js';

let root;
let $;
let selected = new Set(DEFAULT_LINEUP);
let running = false;

export function init(r) {
  root = r;
  $ = els(root);
  renderList();
  syncOpts();
  on('strategies', () => {
    const ids = new Set(allStrategies().map((s) => s.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    renderList();
    markStale();
  });
  on('settings', () => { syncOpts(); markStale(); });

  $.list.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
    updateCount();
  });
  $.reps.addEventListener('change', () => setSettings({ reps: Number($.reps.value) }));
  $.self.addEventListener('change', () => setSettings({ selfPlay: $.self.checked }));

  actions(root, {
    't-pick': (v) => {
      const all = allStrategies();
      if (v === 'all') selected = new Set(all.map((s) => s.id));
      if (v === 'none') selected = new Set();
      if (v === 'classic') selected = new Set(DEFAULT_LINEUP);
      if (v === 'nice') selected = new Set(all.filter((s) => s.tags?.includes('nice')).map((s) => s.id));
      renderList();
    },
    't-run': () => run(),
  });
}

export function show() {
  const last = getLastTournament();
  if (last && $.results.hidden) render(last);
}

function syncOpts() {
  const s = getSettings();
  $.reps.value = s.reps;
  $.self.checked = s.selfPlay;
}

function renderList() {
  $.list.replaceChildren(...allStrategies().map((s) => h('li', {},
    h('label', { class: 'checklist__item' },
      h('input', { type: 'checkbox', value: s.id, checked: selected.has(s.id) }),
      swatch(s.fill, 14),
      h('span', { class: 'checklist__name', text: s.name }),
      s.builtin ? null : h('span', { class: 'tag tag--you', text: 'yours' })))));
  updateCount();
}

function updateCount() {
  $.count.textContent = String(selected.size);
  $.run.disabled = running || selected.size < 2;
}

function markStale() {
  if (!$.results.hidden) $.stale.hidden = false;
}

async function run() {
  if (running || selected.size < 2) return;
  running = true;
  updateCount();
  const defs = allStrategies().filter((s) => selected.has(s.id));
  const settings = getSettings();
  $.progress.hidden = false;
  $.bar.style.setProperty('--p', '0%');
  $.run.textContent = 'Running…';
  try {
    const result = await runTournament(defs, settings, (p) => $.bar.style.setProperty('--p', `${(p * 100).toFixed(0)}%`));
    const t = { defs, result, settings };
    setLastTournament(t);
    render(t);
  } catch (err) {
    toast(`Tournament failed: ${err.message}`);
  } finally {
    running = false;
    $.progress.hidden = true;
    $.run.textContent = 'Run tournament';
    updateCount();
  }
}

function render(t) {
  const { defs, result, settings } = t;
  $.empty.hidden = true;
  $.results.hidden = false;
  $.stale.hidden = JSON.stringify(settings) === JSON.stringify(getSettings());
  const length = settings.randomLength ? `about ${Math.round(result.meanLength)}` : String(settings.rounds);
  $.meta.textContent = `${defs.length} entrants · ${result.matches} matches of ${length} rounds · seed ${settings.seed}`;
  renderBoard(t);
  $.insight.textContent = summarize(t);
  renderHeatmap(t);
}

function renderBoard({ defs, result, settings }) {
  const max = Math.max(...result.avg);
  const min = Math.min(settings.payoff.S, ...result.avg);
  $.board.replaceChildren(...result.ranking.map((i, rank) => {
    const d = defs[i];
    const fill = h('span', { class: 'board__fill' });
    fill.style.setProperty('--w', `${(((result.avg[i] - min) / (max - min || 1)) * 92 + 8).toFixed(1)}%`);
    const err = result.errors[i];
    return h('li', { class: `board__row${rank === 0 ? ' board__row--first' : ''}` },
      h('span', { class: 'board__rank', text: String(rank + 1) }),
      h('span', { class: 'board__name' }, swatch(d.fill, 14), h('span', { text: d.name }),
        d.tags?.includes('nice') ? h('span', { class: 'tag', text: 'nice' }) : null,
        err ? h('span', { class: 'tag tag--error', text: 'crashed', title: `Line ${err.line}: ${err.message}` }) : null),
      h('span', { class: 'board__track' }, fill),
      h('span', { class: 'board__score', text: fmt(result.avg[i]) }),
      h('span', { class: 'board__sub', text: `won ${result.wins[i]} · drew ${result.draws[i]} · quiet ${pct(result.coopAvg[i])}` }));
  }));
}

function summarize({ defs, result }) {
  const n = defs.length;
  const winner = result.ranking[0];
  const top = result.ranking.slice(0, Math.min(5, n));
  const niceTop = top.filter((i) => defs[i].tags?.includes('nice')).length;
  const mostWins = [...Array(n).keys()].sort((a, b) => result.wins[b] - result.wins[a])[0];
  const parts = [`${defs[winner].name} wins with ${fmt(result.avg[winner])} crumbs a round.`];
  if (n >= 5) parts.push(`${niceTop} of the top ${top.length} never rat first.`);
  if (mostWins !== winner) {
    parts.push(`${defs[mostWins].name} won the most matches (${result.wins[mostWins]}) and still finished ${ordinal(result.ranking.indexOf(mostWins) + 1)}.`);
  }
  return parts.join(' ');
}

// Rows and columns in ranking order, so the winners sit top left.
function renderHeatmap({ defs, result, settings }) {
  const order = result.ranking;
  const played = (i, j) => i !== j || settings.selfPlay;
  const values = order.flatMap((i) => order.filter((j) => played(i, j)).map((j) => result.score[i][j]));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const head = h('tr', {}, h('th', { class: 'heat__corner', scope: 'col' }, h('span', { text: 'row vs column' })),
    ...order.map((j) => h('th', { scope: 'col', class: 'heat__col', title: defs[j].name }, h('span', { text: defs[j].short || defs[j].name }))));
  const rows = order.map((i) => h('tr', {},
    h('th', { scope: 'row', class: 'heat__row' }, swatch(defs[i].fill, 12), h('span', { text: defs[i].name })),
    ...order.map((j) => {
      if (!played(i, j)) return h('td', { class: 'heat__cell heat__cell--none' });
      const v = result.score[i][j];
      const bin = Math.min(4, Math.floor(((v - lo) / (hi - lo || 1)) * 5));
      return h('td', { class: `heat__cell heat__cell--${bin}` },
        h('a', {
          href: `#duel?a=${encodeURIComponent(defs[i].id)}&b=${encodeURIComponent(defs[j].id)}`,
          title: `${defs[i].name} vs ${defs[j].name}: ${fmt(v)} vs ${fmt(result.score[j][i])} a round`,
          text: v.toFixed(1),
        }));
    })));
  $.heat.replaceChildren(h('thead', {}, head), h('tbody', {}, ...rows));
  const step = (hi - lo) / 5;
  $['heat-legend'].replaceChildren(...[0, 1, 2, 3, 4].map((b) => h('span', { class: 'legend__item' },
    h('span', { class: `tile heat__cell--${b}` }), `${fmt(lo + step * b, 1)}–${fmt(lo + step * (b + 1), 1)}`)));
}

function ordinal(k) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = k % 100;
  return k + (s[(v - 20) % 10] || s[v] || s[0]);
}
