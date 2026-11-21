// The game itself: matches, tournaments, evolution, and the psych test.
// No DOM in here: the same module runs in the page, in the worker and under node --test.

import { compile, LangError } from './lang.js';
import { BUILTINS, TEST_FIELD } from './strategies.js';

export const C = 0;
export const D = 1;

export const DEFAULT_SETTINGS = {
  payoff: { T: 5, R: 3, P: 1, S: 0 },
  noise: 0,            // chance a move comes out flipped (trembling hand)
  rounds: 150,         // match length, or the average length when randomLength is on
  randomLength: false, // nobody knows when the match ends (geometric length)
  seed: 1980,          // Axelrod's first tournament
  reps: 5,             // tournament repetitions per pairing
  selfPlay: true,      // in a tournament, also play against your own twin
};

// ---------------------------------------------------------------- randomness

// mulberry32: tiny, fast, good enough for games. Every match gets its own streams,
// so results don't depend on the order things run in.
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mix(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let x = typeof p === 'number' ? p | 0 : hashString(String(p));
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    h = Math.imul(h ^ x, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function matchLength(settings, seed) {
  if (!settings.randomLength) return settings.rounds;
  // Geometric: after every round the match goes on with probability w.
  const w = 1 - 1 / Math.max(2, settings.rounds);
  const u = rng(seed)();
  return Math.max(1, Math.min(settings.rounds * 10, Math.ceil(Math.log(1 - u) / Math.log(w))));
}

// ---------------------------------------------------------------- payoffs

function payoffTable({ T, R, P, S }) {
  // table[my][their]
  return [[R, S], [T, P]];
}

export function checkPayoff({ T, R, P, S }) {
  const problems = [];
  if (![T, R, P, S].every(Number.isFinite)) problems.push('All four payoffs must be numbers.');
  else {
    if (!(T > R)) problems.push('T must beat R, or nobody is tempted.');
    if (!(R > P)) problems.push('R must beat P, or cooperating is pointless.');
    if (!(P > S)) problems.push('P must beat S, or being the sucker is fine.');
    if (!(2 * R > T + S)) problems.push('2R should beat T + S, or taking turns to betray beats cooperating.');
  }
  return problems;
}

// ---------------------------------------------------------------- strategies

const programCache = new Map();

export function program(source) {
  let p = programCache.get(source);
  if (!p) {
    p = compile(source);
    programCache.set(source, p);
    if (programCache.size > 500) programCache.delete(programCache.keys().next().value);
  }
  return p;
}

export const BUILTIN_BY_ID = Object.fromEntries(BUILTINS.map((s) => [s.id, { ...s, builtin: true }]));

function newHistory(len) {
  return { m: new Uint8Array(len), pay: new Float64Array(len), n: 0, coop: 0, def: 0, score: 0 };
}

// A match between two strategies (or a strategy and a human: pass null and give
// the move to step()). Defs are { id, name, source }.
export class Match {
  constructor(defA, defB, settings, { seed = settings.seed, length } = {}) {
    this.settings = settings;
    this.length = length ?? matchLength(settings, mix(seed, 'len'));
    this.payoff = settings.payoff;
    this.table = payoffTable(settings.payoff);
    this.noise = settings.noise || 0;
    this.noiseRng = rng(mix(seed, 'noise'));
    this.a = newHistory(this.length);
    this.b = newHistory(this.length);
    this.flipsA = new Uint8Array(this.length);
    this.flipsB = new Uint8Array(this.length);
    this.errors = [null, null];
    this.round = 0;
    this.pa = defA ? program(defA.source).instance() : null;
    this.pb = defB ? program(defB.source).instance() : null;
    this.viewA = { round: 0, my: this.a, their: this.b, rng: rng(mix(seed, 'A')), payoff: this.payoff };
    this.viewB = { round: 0, my: this.b, their: this.a, rng: rng(mix(seed, 'B')), payoff: this.payoff };
  }

  get done() { return this.round >= this.length; }

  ask(side) {
    const p = side === 0 ? this.pa : this.pb;
    const view = side === 0 ? this.viewA : this.viewB;
    view.round = this.round + 1;
    if (this.errors[side]) return C;
    try {
      return p.move(view);
    } catch (err) {
      // A broken strategy cooperates for the rest of the match; the error is reported.
      this.errors[side] = err instanceof LangError ? err : new LangError(String(err.message || err));
      return C;
    }
  }

  // Plays one round. humanA / humanB override that side's choice.
  step(humanA, humanB) {
    if (this.done) return null;
    const wantA = humanA ?? this.ask(0);
    const wantB = humanB ?? this.ask(1);
    let a = wantA;
    let b = wantB;
    if (this.noise > 0) {
      if (this.noiseRng() < this.noise) { a = 1 - a; this.flipsA[this.round] = 1; }
      if (this.noiseRng() < this.noise) { b = 1 - b; this.flipsB[this.round] = 1; }
    }
    const pa = this.table[a][b];
    const pb = this.table[b][a];
    record(this.a, a, pa);
    record(this.b, b, pb);
    this.round++;
    return { a, b, pa, pb, wantA, wantB, round: this.round };
  }

  run() {
    while (!this.done) this.step();
    return this;
  }
}

function record(h, move, pay) {
  h.m[h.n] = move;
  h.pay[h.n] = pay;
  h.n++;
  if (move) h.def++; else h.coop++;
  h.score += pay;
}

export function playMatch(defA, defB, settings, opts) {
  return new Match(defA, defB, settings, opts).run();
}

// Checks a strategy compiles and survives a few opponents. Returns null or a LangError.
export function validate(def, settings = DEFAULT_SETTINGS) {
  try {
    program(def.source);
  } catch (err) {
    return err;
  }
  const probes = ['allc', 'alld', 'random', 'tft', 'alternator'];
  for (const id of probes) {
    for (let s = 0; s < 3; s++) {
      const m = playMatch(def, BUILTIN_BY_ID[id], { ...settings, randomLength: false, rounds: 60 }, { seed: mix(s, id) });
      if (m.errors[0]) return m.errors[0];
    }
  }
  return null;
}

// ---------------------------------------------------------------- tournament

// Round robin. Every pairing is played `reps` times; with random lengths every
// pairing in the same repetition gets the same length, so nobody is luckier.
export function tournament(defs, settings, onProgress) {
  const n = defs.length;
  const reps = Math.max(1, settings.reps | 0);
  const score = Array.from({ length: n }, () => new Float64Array(n));   // avg per round, row vs col
  const coop = Array.from({ length: n }, () => new Float64Array(n));    // row's cooperation rate vs col
  const wins = new Float64Array(n);
  const draws = new Float64Array(n);
  const errors = new Array(n).fill(null);
  const lengths = [];
  for (let r = 0; r < reps; r++) lengths.push(matchLength(settings, mix(settings.seed, 'rep', r)));

  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j && !settings.selfPlay) continue;
      pairs.push([i, j]);
    }
  }
  const total = pairs.length * reps;
  let done = 0;
  let lastReport = 0;

  for (const [i, j] of pairs) {
    for (let r = 0; r < reps; r++) {
      const m = playMatch(defs[i], defs[j], settings, {
        seed: mix(settings.seed, defs[i].id, defs[j].id, r),
        length: lengths[r],
      });
      const len = m.length;
      const sa = m.a.score / len;
      const sb = m.b.score / len;
      if (i === j) {
        score[i][i] += (sa + sb) / 2 / reps;
        coop[i][i] += (m.a.coop + m.b.coop) / 2 / len / reps;
      } else {
        score[i][j] += sa / reps;
        score[j][i] += sb / reps;
        coop[i][j] += m.a.coop / len / reps;
        coop[j][i] += m.b.coop / len / reps;
        if (sa > sb) wins[i]++;
        else if (sb > sa) wins[j]++;
        else { draws[i]++; draws[j]++; }
      }
      if (m.errors[0] && !errors[i]) errors[i] = describeError(m.errors[0]);
      if (m.errors[1] && !errors[j]) errors[j] = describeError(m.errors[1]);
      done++;
      if (onProgress && done - lastReport >= 50) {
        lastReport = done;
        onProgress(done / total);
      }
    }
  }

  const avg = new Float64Array(n);
  const coopAvg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    let k = 0;
    for (let j = 0; j < n; j++) {
      if (i === j && !settings.selfPlay) continue;
      s += score[i][j];
      c += coop[i][j];
      k++;
    }
    avg[i] = k ? s / k : 0;
    coopAvg[i] = k ? c / k : 0;
  }
  const ranking = [...Array(n).keys()].sort((x, y) => avg[y] - avg[x] || wins[y] - wins[x]);
  return {
    ids: defs.map((d) => d.id),
    score: score.map((row) => [...row]),
    coop: coop.map((row) => [...row]),
    avg: [...avg],
    coopAvg: [...coopAvg],
    wins: [...wins],
    draws: [...draws],
    ranking,
    errors,
    matches: total,
    meanLength: lengths.reduce((a, b) => a + b, 0) / lengths.length,
  };
}

function describeError(err) {
  return { message: err.message, line: err.line || 0, col: err.col || 0 };
}

// ---------------------------------------------------------------- evolution

// Discrete replicator dynamics on a payoff matrix (avg per round, row vs col).
// Shares below 1 in `population` die out unless mutation brings them back.
export function replicator(matrix, start, generations, { mutation = 0, population = 10000 } = {}) {
  const n = matrix.length;
  let min = Infinity;
  for (const row of matrix) for (const v of row) min = Math.min(min, v);
  const shift = min <= 0 ? 0.01 - min : 0;
  let x = normalize(start.slice());
  const history = [x.slice()];
  for (let g = 0; g < generations; g++) {
    const f = new Array(n).fill(0);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      if (!x[i]) continue;
      let s = 0;
      for (let j = 0; j < n; j++) s += matrix[i][j] * x[j];
      f[i] = s + shift;
      mean += x[i] * f[i];
    }
    let next = x.map((xi, i) => (mean > 0 ? (xi * f[i]) / mean : xi));
    if (mutation > 0) next = next.map((v) => (1 - mutation) * v + mutation / n);
    const cut = 1 / population;
    next = next.map((v) => (v < cut ? 0 : v));
    x = normalize(next);
    history.push(x.slice());
  }
  return history;
}

function normalize(x) {
  const s = x.reduce((a, b) => a + b, 0);
  return s > 0 ? x.map((v) => v / s) : x.map(() => 1 / x.length);
}

// ---------------------------------------------------------------- spatial games

// Moore neighbourhood (8 cells) on a torus.
const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// One generation of a spatial game. grid holds a type index per cell; pay(a, b) is
// what type a earns against type b in one encounter. Every cell then copies the
// best scorer around it (itself included, and it keeps its own type on a tie).
// Returns the new grid; scores is a scratch buffer.
export function spatialStep(grid, size, pay, scores, { selfInteraction = false, mutation = 0, types = 2, rand = Math.random } = {}) {
  const next = new Uint8Array(grid.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const me = grid[i];
      let s = selfInteraction ? pay(me, me) : 0;
      for (const [dx, dy] of NEIGHBOURS) {
        s += pay(me, grid[((y + dy + size) % size) * size + ((x + dx + size) % size)]);
      }
      scores[i] = s;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let best = grid[i];
      let bestScore = scores[i];
      for (const [dx, dy] of NEIGHBOURS) {
        const j = ((y + dy + size) % size) * size + ((x + dx + size) % size);
        if (scores[j] > bestScore + 1e-9) {
          bestScore = scores[j];
          best = grid[j];
        }
      }
      next[i] = mutation > 0 && rand() < mutation ? Math.floor(rand() * types) : best;
    }
  }
  return next;
}

// ---------------------------------------------------------------- psych test

const PROBES = {
  // Cooperates, but sneaks in a betrayal now and then.
  sneak: { id: '_sneak', name: 'Sneak', source: 'if round == 10 or round == 25 or round == 40 then return D end\nreturn C' },
  // Betrays three times in a row, then cooperates forever.
  repent: { id: '_repent', name: 'Repent', source: 'if round >= 10 and round <= 12 then return D end\nreturn C' },
};

// Five traits between 0 and 1, measured against fixed probes with fixed seeds.
export function psych(def, settings = DEFAULT_SETTINGS) {
  const base = { ...settings, noise: 0, randomLength: false };
  const seeds = [11, 23, 37, 41, 59];
  const avg = (f) => seeds.reduce((s, seed) => s + f(seed), 0) / seeds.length;

  const nice = avg((seed) => {
    const m = playMatch(def, BUILTIN_BY_ID.allc, { ...base, rounds: 50 }, { seed });
    return m.a.coop / m.length;
  });

  const provocable = avg((seed) => {
    const m = playMatch(def, PROBES.sneak, { ...base, rounds: 50 }, { seed });
    let hit = 0;
    for (const r of [10, 25, 40]) if (m.a.m[r] === D || m.a.m[r + 1] === D) hit++;
    return hit / 3;
  });

  const forgiving = avg((seed) => {
    const m = playMatch(def, PROBES.repent, { ...base, rounds: 60 }, { seed });
    let c = 0;
    for (let r = 24; r < 60; r++) if (m.a.m[r] === C) c++;
    return c / 36;
  });

  const spine = avg((seed) => {
    const m = playMatch(def, BUILTIN_BY_ID.alld, { ...base, rounds: 50 }, { seed });
    let d = 0;
    for (let r = 3; r < 50; r++) if (m.a.m[r] === D) d++;
    return d / 47;
  });

  const { R, P } = settings.payoff;
  const calm = avg((seed) => {
    const m = playMatch(def, def, { ...base, noise: 0.05, rounds: 200 }, { seed });
    const perRound = (m.a.score + m.b.score) / 2 / m.length;
    return Math.max(0, Math.min(1, (perRound - P) / (R - P)));
  });

  return { nice, provocable, forgiving, spine, calm };
}

export const TRAITS = [
  { key: 'nice', label: 'Nice', hint: 'How much it cooperates with someone who always cooperates.' },
  { key: 'provocable', label: 'Provocable', hint: 'Does it hit back when betrayed out of the blue?' },
  { key: 'forgiving', label: 'Forgiving', hint: 'Does it go back to cooperating once the other side does?' },
  { key: 'spine', label: 'Spine', hint: 'Does it stop feeding someone who always defects?' },
  { key: 'calm', label: 'Noise-proof', hint: 'With 5% of moves flipped at random, how well it does against its own twin.' },
];

// One-liner in the house voice, from the traits.
export function verdict(t) {
  if (t.nice > 0.95 && t.spine < 0.1) return 'A saint. Saints get eaten.';
  if (t.nice < 0.1 && t.spine > 0.9) return 'A rat. Wins every fight, loses every friend.';
  if (t.nice > 0.95 && t.provocable > 0.6 && t.forgiving > 0.6) {
    return t.calm > 0.7 ? 'Nice, tough, forgiving and calm. Axelrod would buy you a beer.' : 'Nice, tough, forgiving. Textbook. A bit jumpy when things get noisy.';
  }
  if (t.nice > 0.95 && t.provocable > 0.6 && t.forgiving < 0.2) return 'Nice until you cross it. Then it never lets go.';
  if (t.nice > 0.95 && t.provocable < 0.4) return 'Nice and patient. Patient is a polite word for exploitable.';
  if (t.nice < 0.95 && t.nice > 0.5) return 'Mostly nice. Keep an eye on your wallet.';
  if (t.nice <= 0.5 && t.forgiving > 0.5) return 'Shifty, but it can be talked round.';
  return 'Hard to read. That might be the point.';
}

// A strategy's showing against the reference field (plus its own twin).
export function fieldTest(def, settings) {
  const field = TEST_FIELD.map((id) => BUILTIN_BY_ID[id]).filter((d) => d.id !== def.id);
  const defs = [def, ...field];
  const res = tournament(defs, { ...settings, reps: Math.min(settings.reps, 3) });
  const rank = res.ranking.indexOf(0) + 1;
  return { result: res, defs, rank, of: defs.length };
}
