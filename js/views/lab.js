// Lab: write a strategy (script or dials), get it tested as you type, save it.

import { program, validate, psych, fieldTest, verdict, TRAITS, BUILTIN_BY_ID } from '../engine.js';
import { BUILTINS, STARTER_SOURCE } from '../strategies.js';
import {
  getSettings, on, customStrategies, saveCustom, deleteCustom, getDraft, setDraft, encodeShare, decodeShare, getStrategy,
} from '../store.js';
import { h, els, actions, renderCode, barList, fmt, pct, toast } from '../ui.js';
import { radar } from '../charts.js';

const DIALS = [
  { label: 'Opening move', hint: 'round 1' },
  { label: 'After you both kept quiet', hint: 'you got R' },
  { label: 'After you kept quiet and they ratted', hint: 'you got S' },
  { label: 'After you ratted and they kept quiet', hint: 'you got T' },
  { label: 'After you both ratted', hint: 'you got P' },
];
const PRESETS = {
  tft: [1, 1, 0, 1, 0],
  wsls: [1, 1, 0, 0, 1],
  gtft: [1, 1, 1 / 3, 1, 1 / 3],
  extort: [1, 8 / 9, 1 / 2, 1 / 3, 0],
  random: [0.5, 0.5, 0.5, 0.5, 0.5],
};

let root;
let $;
let draft;
let evalTimer = 0;
let lastPsych = null;
let tftPsych = null;
let dialInputs = [];

function dialsToSource(d) {
  const p = (v) => (v >= 1 ? 'C' : v <= 0 ? 'D' : `mix(${+v.toFixed(3)})`);
  return `-- Dials: the chance of keeping quiet depends only on last round.
if round == 1 then return ${p(d[0])} end
if my.last == C and their.last == C then return ${p(d[1])} end
if my.last == C then return ${p(d[2])} end
if their.last == C then return ${p(d[3])} end
return ${p(d[4])}`;
}

export function init(r) {
  root = r;
  $ = els(root);
  draft = getDraft() || { id: null, name: 'My pigeon', mode: 'script', source: STARTER_SOURCE, dials: PRESETS.tft.slice() };
  if (!Array.isArray(draft.dials)) draft.dials = PRESETS.tft.slice();

  $.fork.append(...BUILTINS.map((b) => h('option', { value: b.id, text: b.name })));
  $.fork.addEventListener('change', () => {
    if ($.fork.value) fork($.fork.value);
    $.fork.value = '';
  });

  buildDials();
  editorEvents();
  $.name.addEventListener('input', () => { draft.name = $.name.value; persist(); });

  actions(root, {
    'lab-mode': (v) => setMode(v),
    'lab-preset': (v) => { draft.dials = PRESETS[v].slice(); syncDials(); dialsChanged(); },
    'lab-dials-to-script': () => setMode('script'),
    'lab-new': () => load({ id: null, name: 'My pigeon', mode: 'script', source: STARTER_SOURCE, dials: PRESETS.tft.slice() }),
    'lab-save': () => save(),
    'lab-delete': () => remove(),
    'lab-duel': () => { const id = save(); if (id) location.hash = `#duel?a=${encodeURIComponent(id)}&b=tft`; },
    'lab-share': () => share(),
    'lab-load': (id) => {
      const c = customStrategies().find((s) => s.id === id);
      if (c) load({ id: c.id, name: c.name, mode: c.dials ? 'dials' : 'script', source: c.source, dials: c.dials || PRESETS.tft.slice() });
    },
  });
  on('strategies', renderMine);
  on('settings', () => { tftPsych = null; if (!root.hidden) scheduleEval(0); });
  load(draft);
}

export function show(params) {
  const code = params.get('share');
  const forkId = params.get('fork');
  const edit = params.get('edit');
  if (code) {
    const s = decodeShare(code);
    if (s) {
      load({ id: null, name: s.name, mode: s.dials ? 'dials' : 'script', source: s.source, dials: s.dials || PRESETS.tft.slice() });
      toast('Loaded a shared strategy. Save it to keep it.');
    } else toast('That share link is broken.');
  } else if (forkId) fork(forkId);
  else if (edit) root.querySelector(`[data-action="lab-load"][data-value="${CSS.escape(edit)}"]`)?.click();
  if (code || forkId || edit) history.replaceState(null, '', '#lab');
  scheduleEval(0);
}

function fork(id) {
  const b = BUILTIN_BY_ID[id] || getStrategy(id);
  if (!b) return;
  load({ id: null, name: `My ${b.name}`.slice(0, 40), mode: 'script', source: b.source, dials: PRESETS.tft.slice() });
}

function load(d) {
  draft = { ...d, dials: d.dials.slice() };
  $.name.value = draft.name;
  $.code.value = draft.source;
  syncDials();
  setMode(draft.mode, true);
  refreshEditor();
  renderMine();
  persist();
  scheduleEval(0);
}

function persist() {
  setDraft(draft);
  $.delete.hidden = !draft.id;
  $.saved.textContent = '';
}

function setMode(m, silent) {
  const overwrite = m === 'dials' && !silent && draft.source !== dialsToSource(draft.dials);
  if (overwrite && !window.confirm('The dials will replace the script in the editor. Go ahead?')) return;
  draft.mode = m;
  root.querySelectorAll('[data-action="lab-mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === m)));
  $['script-pane'].hidden = m !== 'script';
  $['dials-pane'].hidden = m !== 'dials';
  if (m === 'dials' && !silent) dialsChanged();
  if (m === 'script') refreshEditor();
  if (!silent) persist();
}

// ---------------------------------------------------------------- dials

function buildDials() {
  dialInputs = DIALS.map((d, i) => {
    const input = h('input', { class: 'range', type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': d.label });
    const value = h('span', { class: 'dial__value' });
    input.addEventListener('input', () => {
      draft.dials[i] = Number(input.value);
      value.textContent = pct(draft.dials[i]);
      dialsChanged();
    });
    $.dials.append(h('div', { class: 'dial' },
      h('span', { class: 'dial__label' }, h('strong', { text: d.label }), h('span', { class: 'dial__hint', text: ` · ${d.hint}` })),
      input,
      value,
      h('span', { class: 'dial__ends' }, h('span', { text: 'rat' }), h('span', { text: 'keep quiet' }))));
    return { input, value };
  });
}

function syncDials() {
  dialInputs.forEach(({ input, value }, i) => {
    input.value = String(draft.dials[i]);
    value.textContent = pct(draft.dials[i]);
  });
}

function dialsChanged() {
  draft.source = dialsToSource(draft.dials);
  $.code.value = draft.source;
  refreshEditor();
  persist();
  scheduleEval(150);
}

// ---------------------------------------------------------------- editor

function editorEvents() {
  const code = $.code;
  code.addEventListener('input', () => {
    draft.source = code.value;
    if (draft.mode === 'dials') setMode('script', true);
    refreshEditor();
    persist();
    scheduleEval(350);
  });
  code.addEventListener('scroll', () => {
    $.hl.scrollTop = code.scrollTop;
    $.hl.scrollLeft = code.scrollLeft;
    $.gutter.scrollTop = code.scrollTop;
  });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      insert('  ');
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      // Keep the indentation of the current line, plus two after "then" or "else".
      const before = code.value.slice(0, code.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      let indent = /^\s*/.exec(line)[0];
      if (/\b(then|else)\s*$/.test(line)) indent += '  ';
      e.preventDefault();
      insert(`\n${indent}`);
    }
  });
}

function insert(text) {
  const code = $.code;
  // execCommand keeps the browser's undo stack; fall back to setRangeText.
  if (!document.execCommand?.('insertText', false, text)) {
    code.setRangeText(text, code.selectionStart, code.selectionEnd, 'end');
    code.dispatchEvent(new Event('input'));
  }
}

function refreshEditor(errLine = currentErrorLine()) {
  renderCode($.hl, `${$.code.value}\n`);
  const lines = $.code.value.split('\n').length;
  $.gutter.replaceChildren(...Array.from({ length: lines }, (_, i) => h('span', { class: `code__ln${i + 1 === errLine ? ' code__ln--error' : ''}`, text: String(i + 1) })));
}

function currentErrorLine() {
  try {
    program($.code.value);
    return 0;
  } catch (err) {
    return err.line || 0;
  }
}

// ---------------------------------------------------------------- evaluation

function scheduleEval(delay) {
  clearTimeout(evalTimer);
  evalTimer = setTimeout(evaluate, delay);
}

function evaluate() {
  const settings = getSettings();
  const def = { id: draft.id || 'draft', name: draft.name || 'Your pigeon', source: draft.source };
  const err = validate(def, settings);
  refreshEditor(err ? err.line : 0);
  $.status.classList.toggle('code__status--error', Boolean(err));
  $.save.disabled = Boolean(err);
  if (err) {
    $.status.textContent = err.line ? `Line ${err.line}, column ${err.col}: ${err.message}` : err.message;
    return;
  }
  const lines = draft.source.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).length;
  $.status.textContent = `Compiles. ${lines} line${lines === 1 ? '' : 's'} of actual code. Survived the test opponents.`;

  const t = psych(def, settings);
  lastPsych = t;
  tftPsych ||= psych(BUILTIN_BY_ID.tft, settings);
  $.radar.replaceChildren(radar(TRAITS.map((x) => ({ label: x.label, value: t[x.key] })), {
    size: 280,
    compare: TRAITS.map((x) => ({ label: x.label, value: tftPsych[x.key] })),
  }), h('p', { class: 'psych__key' }, h('span', { class: 'legend__line legend__line--dash' }), 'Tit for Tat, for reference'));
  $.verdict.textContent = verdict(t);
  $.traits.replaceChildren(...TRAITS.map((x) => h('li', { class: 'traits__item' },
    h('span', { class: 'traits__label', text: x.label }),
    h('span', { class: 'traits__value', text: pct(t[x.key]) }),
    h('span', { class: 'traits__hint', text: x.hint }))));

  const f = fieldTest(def, settings);
  const res = f.result;
  $.rank.textContent = `Ranked ${f.rank} of ${f.of} · ${fmt(res.avg[0])} a round`;
  const rows = f.defs.slice(1).map((d, k) => ({
    label: `vs ${d.name}`,
    value: res.score[0][k + 1],
    sub: `they got ${fmt(res.score[k + 1][0])}`,
    fill: getStrategy(d.id)?.fill,
  }));
  if (settings.selfPlay) rows.unshift({ label: 'vs its own twin', value: res.score[0][0], highlight: true });
  barList($.field, rows, { max: settings.payoff.T });
}

// ---------------------------------------------------------------- save / share

function save() {
  const res = saveCustom({ id: draft.id, name: $.name.value, source: draft.source, dials: draft.mode === 'dials' ? draft.dials : null, nice: (lastPsych?.nice ?? 0) > 0.99 });
  if (!res.ok) {
    toast(`Can't save: ${res.error.message}`);
    return null;
  }
  draft.id = res.id;
  draft.name = $.name.value.trim() || 'Nameless pigeon';
  persist();
  renderMine();
  $.saved.textContent = 'Saved. It plays everywhere now.';
  return res.id;
}

function remove() {
  if (!draft.id) return;
  if (!window.confirm(`Delete "${draft.name}"? This can't be undone.`)) return;
  deleteCustom(draft.id);
  draft.id = null;
  persist();
  renderMine();
  toast('Deleted. The code is still in the editor if you change your mind.');
}

async function share() {
  const code = encodeShare({ name: $.name.value || 'Shared pigeon', source: draft.source, dials: draft.mode === 'dials' ? draft.dials : null });
  const url = `${location.origin}${location.pathname}#lab?share=${code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. The strategy is inside the link; nothing is uploaded.');
  } catch {
    window.prompt('Copy this link:', url);
  }
}

function renderMine() {
  const mine = customStrategies();
  $.mine.replaceChildren(...(mine.length ? mine.map((s) => h('button', {
    type: 'button',
    class: 'chip',
    'data-action': 'lab-load',
    'data-value': s.id,
    'aria-pressed': String(s.id === draft.id),
    text: s.name,
  })) : [h('span', { class: 'lab-mine__none', text: 'None yet.' })]));
}
