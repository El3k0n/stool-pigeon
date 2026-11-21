// Entry point: routing between sections, the house rules dialog, shared text slots.

import { getSettings, setSettings, resetSettings, summary, on, emit } from './store.js';
import { checkPayoff } from './engine.js';
import { h } from './ui.js';
import * as play from './views/play.js';
import * as duel from './views/duel.js';
import * as tournament from './views/tournament.js';
import * as evolution from './views/evolution.js';
import * as turf from './views/turf.js';
import * as lab from './views/lab.js';
import * as guide from './views/guide.js';

document.documentElement.classList.add('js');

const VIEWS = { intro: null, play, duel, tournament, evolution, turf, lab, guide };
const started = new Set();
let current = null;

function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  const [name, query = ''] = raw.split('?');
  return { name: name in VIEWS ? name : 'intro', params: new URLSearchParams(query) };
}

function route() {
  const { name, params } = parseHash();
  const changed = name !== current;
  if (changed && current && VIEWS[current]?.hide) VIEWS[current].hide();
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const mod = VIEWS[name];
  const root = document.getElementById(`view-${name}`);
  if (mod && !started.has(name)) {
    started.add(name);
    mod.init(root);
  }
  current = name;
  if (mod?.show) mod.show(params);
  if (changed) {
    window.scrollTo({ top: 0 });
    document.querySelector(`[data-tab="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  document.title = `${name === 'intro' ? 'Stool Pigeon' : `${document.querySelector(`[data-tab="${name}"]`).textContent} · Stool Pigeon`} — a prisoner's dilemma lab`;
}

// ---------------------------------------------------------------- shared text

function renderSettingsText() {
  const s = getSettings();
  document.querySelectorAll('[data-text="rules-summary"]').forEach((el) => { el.textContent = summary(s); });
  for (const k of ['T', 'R', 'P', 'S']) {
    document.querySelectorAll(`[data-text="pay-${k}"]`).forEach((el) => { el.textContent = String(s.payoff[k]); });
  }
}

// ---------------------------------------------------------------- rules dialog

const dialog = document.getElementById('rules');
const form = dialog.querySelector('form');
const warn = dialog.querySelector('[data-el="warn"]');
const noiseLabel = dialog.querySelector('[data-el="noise-label"]');

function fillForm() {
  const s = getSettings();
  for (const k of ['T', 'R', 'P', 'S']) form.elements[k].value = s.payoff[k];
  form.elements.rounds.value = s.rounds;
  form.elements.randomLength.checked = s.randomLength;
  form.elements.noise.value = s.noise * 100;
  form.elements.seed.value = s.seed;
  noiseLabel.textContent = `${+(s.noise * 100).toFixed(1)}%`;
  showWarnings(s.payoff);
}

function showWarnings(payoff) {
  warn.replaceChildren(...checkPayoff(payoff).map((p) => h('li', { text: p })));
}

form.addEventListener('input', (e) => {
  const el = e.target;
  if (['T', 'R', 'P', 'S'].includes(el.name)) {
    const payoff = {};
    for (const k of ['T', 'R', 'P', 'S']) payoff[k] = form.elements[k].value === '' ? NaN : Number(form.elements[k].value);
    showWarnings(payoff);
    // Nonsense (empty or equal values) is not applied; a merely odd matrix is, with a warning.
    const usable = Object.values(payoff).every(Number.isFinite) && payoff.R !== payoff.P && payoff.T !== payoff.S;
    if (usable) setSettings({ payoff });
  } else if (el.name === 'rounds') {
    if (el.value !== '' && Number(el.value) >= 1) setSettings({ rounds: Number(el.value) });
  } else if (el.name === 'randomLength') {
    setSettings({ randomLength: el.checked });
  } else if (el.name === 'noise') {
    setSettings({ noise: Number(el.value) / 100 });
    noiseLabel.textContent = `${+Number(el.value).toFixed(1)}%`;
  } else if (el.name === 'seed') {
    if (el.value !== '') setSettings({ seed: Number(el.value) });
  }
});

dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();   // click on the backdrop
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'rules-reset') { resetSettings(); fillForm(); }
  if (action === 'rules-reseed') { setSettings({ seed: Math.floor(Math.random() * 1e6) }); fillForm(); }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="open-rules"]')) {
    fillForm();
    dialog.showModal();
  }
});

// ---------------------------------------------------------------- go

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => emit('resize'), 120);
});

on('settings', renderSettingsText);
renderSettingsText();
window.addEventListener('hashchange', route);
route();
// Canvas text needs the web fonts: redraw once they are in.
document.fonts?.ready.then(() => emit('resize'));
