// Field guide: every strategy, with its source and a psych profile.

import { psych, verdict, TRAITS } from '../engine.js';
import { getSettings, allStrategies, on } from '../store.js';
import { h, els, actions, swatch, renderCode } from '../ui.js';
import { radar } from '../charts.js';

let root;
let $;
let filter = 'all';
let dirty = true;
const cache = new Map();   // id + source + payoff -> traits

export function init(r) {
  root = r;
  $ = els(root);
  actions(root, {
    'g-filter': (v) => {
      filter = v;
      root.querySelectorAll('[data-action="g-filter"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === v)));
      applyFilter();
    },
  });
  on('strategies', () => { dirty = true; if (!root.hidden) render(); });
  on('settings', () => { dirty = true; if (!root.hidden) render(); });
}

export function show() { if (dirty) render(); }

function traitsFor(s, settings) {
  const key = `${s.id}|${s.source}|${JSON.stringify(settings.payoff)}`;
  if (!cache.has(key)) cache.set(key, psych(s, settings));
  return cache.get(key);
}

function render() {
  dirty = false;
  const settings = getSettings();
  $.cards.replaceChildren(...allStrategies().map((s) => {
    const t = traitsFor(s, settings);
    const code = h('pre', { class: 'card__code' });
    renderCode(code, s.source);
    const tags = (s.tags || []).filter((x) => x !== 'custom');
    return h('li', { class: `card${s.builtin ? '' : ' card--yours'}`, 'data-tags': (s.tags || []).join(' ') },
      h('div', { class: 'card__head' },
        swatch(s.fill, 18),
        h('h3', { class: 'card__name', text: s.name }),
        h('span', { class: 'card__short', text: s.short || '' })),
      h('div', { class: 'card__tags' },
        ...tags.map((x) => h('span', { class: `tag${x === 'nice' ? ' tag--nice' : x === 'nasty' ? ' tag--nasty' : ''}`, text: tagLabel(x) })),
        s.builtin ? null : h('span', { class: 'tag tag--you', text: 'yours' })),
      h('p', { class: 'card__blurb', text: s.blurb || verdict(t) }),
      h('div', { class: 'card__radar' }, radar(TRAITS.map((x) => ({ label: x.label, value: t[x.key] })), { size: 220 })),
      h('details', { class: 'card__src' }, h('summary', { text: 'Source' }), code),
      h('div', { class: 'card__actions' },
        h('a', { class: 'btn btn--small btn--ink', href: `#duel?a=${encodeURIComponent(s.id)}&b=tft`, text: 'Duel' }),
        s.builtin
          ? h('a', { class: 'btn btn--small btn--white', href: `#lab?fork=${encodeURIComponent(s.id)}`, text: 'Fork' })
          : h('a', { class: 'btn btn--small btn--white', href: `#lab?edit=${encodeURIComponent(s.id)}`, text: 'Edit' })));
  }));
  applyFilter();
}

function tagLabel(x) {
  return { nice: 'nice', nasty: 'rats first', random: 'uses dice', classic: '1980' }[x] || x;
}

function applyFilter() {
  $.cards.querySelectorAll('.card').forEach((c) => {
    const tags = c.dataset.tags.split(' ');
    c.hidden = filter !== 'all' && !tags.includes(filter);
  });
}
