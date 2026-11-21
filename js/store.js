// Shared state: the house rules, your saved strategies, and a tiny event bus.
// Everything persists in localStorage, in this browser only.

import { BUILTINS } from './strategies.js';
import { DEFAULT_SETTINGS, validate, program } from './engine.js';

const KEY_SETTINGS = 'stoolpigeon.settings.v1';
const KEY_CUSTOM = 'stoolpigeon.custom.v1';
const KEY_DRAFT = 'stoolpigeon.draft.v1';

const listeners = {};
export function on(event, fn) { (listeners[event] ||= []).push(fn); }
export function emit(event, data) { (listeners[event] || []).forEach((fn) => fn(data)); }

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep it in memory */ }
}

// ---------------------------------------------------------------- settings

function cleanSettings(s) {
  const d = DEFAULT_SETTINGS;
  const numOr = (v, f) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : f);
  const p = s.payoff || {};
  return {
    payoff: { T: numOr(p.T, d.payoff.T), R: numOr(p.R, d.payoff.R), P: numOr(p.P, d.payoff.P), S: numOr(p.S, d.payoff.S) },
    noise: Math.max(0, Math.min(0.5, numOr(s.noise, d.noise))),
    rounds: Math.max(1, Math.min(2000, Math.round(numOr(s.rounds, d.rounds)))),
    randomLength: Boolean(s.randomLength),
    seed: Math.max(0, Math.round(numOr(s.seed, d.seed))) >>> 0,
    reps: Math.max(1, Math.min(50, Math.round(numOr(s.reps, d.reps)))),
    selfPlay: s.selfPlay === undefined ? d.selfPlay : Boolean(s.selfPlay),
  };
}

let settings = cleanSettings(load(KEY_SETTINGS, DEFAULT_SETTINGS));

export function getSettings() { return settings; }

export function setSettings(patch) {
  const next = cleanSettings({ ...settings, ...patch, payoff: { ...settings.payoff, ...(patch.payoff || {}) } });
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  save(KEY_SETTINGS, settings);
  emit('settings', settings);
}

export function resetSettings() {
  settings = cleanSettings(DEFAULT_SETTINGS);
  save(KEY_SETTINGS, settings);
  emit('settings', settings);
}

export function summary(s = settings) {
  const { T, R, P, S } = s.payoff;
  const parts = [`T${T} R${R} P${P} S${S}`];
  parts.push(`${s.randomLength ? '~' : ''}${s.rounds} rounds`);
  parts.push(`noise ${+(s.noise * 100).toFixed(1)}%`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- strategies

let custom = load(KEY_CUSTOM, []).filter((c) => c && typeof c.source === 'string' && typeof c.name === 'string');

const BUILTIN_IDS = new Set(BUILTINS.map((b) => b.id));

// Each strategy keeps one fill (colour + pattern) everywhere on the page.
const builtinFill = Object.fromEntries(BUILTINS.map((b, i) => [b.id, i]));

function decorate(s, i) {
  return { ...s, fill: s.builtin ? builtinFill[s.id] : BUILTINS.length + i };
}

export function allStrategies() {
  return [
    ...BUILTINS.map((b) => decorate({ ...b, builtin: true })),
    ...custom.map((c, i) => decorate({ ...c, builtin: false, tags: tagsFor(c), short: shortName(c.name) }, i)),
  ];
}

export function getStrategy(id) {
  return allStrategies().find((s) => s.id === id) || null;
}

export function customStrategies() { return allStrategies().filter((s) => !s.builtin); }

function shortName(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const s = words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 4);
  return s.toUpperCase().slice(0, 4) || 'YOU';
}

function tagsFor(c) {
  const tags = ['custom'];
  if (/\b(chance|mix|random)\s*\(/.test(c.source)) tags.push('random');
  if (typeof c.nice === 'boolean') tags.push(c.nice ? 'nice' : 'nasty');
  return tags;
}

function newId() {
  return `u-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Saves (creates or updates) a custom strategy. Returns { ok, id, error }.
export function saveCustom({ id, name, source, dials, nice }) {
  const cleanName = (name || '').trim().slice(0, 40) || 'Nameless pigeon';
  const err = validate({ id: id || 'draft', name: cleanName, source }, settings);
  if (err) return { ok: false, error: err };
  const existing = id && !BUILTIN_IDS.has(id) ? custom.findIndex((c) => c.id === id) : -1;
  const entry = { id: existing >= 0 ? id : newId(), name: cleanName, source, dials: dials || null, nice: Boolean(nice), saved: Date.now() };
  if (existing >= 0) custom[existing] = entry;
  else custom.push(entry);
  save(KEY_CUSTOM, custom);
  emit('strategies');
  return { ok: true, id: entry.id };
}

export function deleteCustom(id) {
  custom = custom.filter((c) => c.id !== id);
  save(KEY_CUSTOM, custom);
  emit('strategies');
}

export function getDraft() { return load(KEY_DRAFT, null); }
export function setDraft(d) { save(KEY_DRAFT, d); }

// ---------------------------------------------------------------- share links

// A strategy travels in the URL fragment, so it never reaches the server.
export function encodeShare({ name, source, dials }) {
  const json = JSON.stringify({ n: name, s: source, d: dials || undefined });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(code) {
  try {
    if (!code || code.length > 12000) return null;
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof obj.s !== 'string' || obj.s.length > 8000) return null;
    const name = typeof obj.n === 'string' ? obj.n.slice(0, 40) : 'Shared pigeon';
    const dials = Array.isArray(obj.d) && obj.d.length === 5 && obj.d.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ? obj.d : null;
    program(obj.s);   // throws if it doesn't compile
    return { name, source: obj.s, dials };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- last tournament

// Evolution starts from whatever the tournament last produced: { defs, result, settings }.
let lastTournament = null;
export function setLastTournament(t) { lastTournament = t; emit('tournament', t); }
export function getLastTournament() { return lastTournament; }
