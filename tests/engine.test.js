import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTINS } from '../js/strategies.js';
import {
  BUILTIN_BY_ID as B, DEFAULT_SETTINGS, playMatch, tournament, replicator, psych, validate,
  matchLength, checkPayoff, spatialStep, fieldTest,
} from '../js/engine.js';

const S = { ...DEFAULT_SETTINGS, rounds: 10 };
const moves = (h) => [...h.m.slice(0, h.n)].map((x) => (x ? 'D' : 'C')).join('');

test('every built-in compiles and survives the probes', () => {
  for (const s of BUILTINS) assert.equal(validate(s), null, s.id);
});

test('classic matchups', () => {
  let m = playMatch(B.tft, B.alld, S);
  assert.equal(moves(m.a), 'CDDDDDDDDD');
  assert.equal(m.a.score, 9);
  assert.equal(m.b.score, 14);
  m = playMatch(B.tft, B.stft, S);
  assert.equal(moves(m.a), 'CDCDCDCDCD');
  m = playMatch(B.grudger, B.alternator, S);
  assert.equal(moves(m.a), 'CCDDDDDDDD');
  m = playMatch(B.prober, B.allc, S);
  assert.equal(moves(m.a), 'DCCDDDDDDD');
  m = playMatch(B.handshake, B.handshake, S);
  assert.equal(moves(m.a), 'DCCCCCCCCC');
  m = playMatch(B.pavlov, B.alld, S);
  assert.equal(moves(m.a), 'CDCDCDCDCD');
  m = playMatch(B.gradual, B.alternator, { ...S, rounds: 12 });
  // Defections during the two calm rounds are not answered, but they count later.
  assert.equal(moves(m.b), 'CDCDCDCDCDCD');
  assert.equal(moves(m.a), 'CCDCCCDDDCCC');
  m = playMatch(B.softgrudger, B.stft, S);
  assert.equal(moves(m.a), 'CDDDDCCCCC');  // the peace offering works
  m = playMatch(B.mo, B.alternator, S);
  assert.equal(moves(m.a), 'CCDCDCDDDD');
});

test('same seed, same match; noise flips moves', () => {
  const noisy = { ...DEFAULT_SETTINGS, noise: 0.1, rounds: 200 };
  const a = playMatch(B.tft, B.joss, noisy);
  const b = playMatch(B.tft, B.joss, noisy);
  assert.equal(moves(a.a), moves(b.a));
  assert.ok(a.flipsA.reduce((x, y) => x + y, 0) > 5);
});

test('random length averages out', () => {
  const s = { ...DEFAULT_SETTINGS, randomLength: true, rounds: 50 };
  let sum = 0;
  for (let i = 0; i < 4000; i++) sum += matchLength(s, i * 7919);
  assert.ok(Math.abs(sum / 4000 - 50) < 3, String(sum / 4000));
});

test('tournament: TFT beats ALLD on average, ALLD never loses a match', () => {
  const defs = ['tft', 'alld', 'allc', 'grudger', 'random'].map((id) => B[id]);
  const r = tournament(defs, { ...DEFAULT_SETTINGS, rounds: 100, reps: 3 });
  const avg = Object.fromEntries(r.ids.map((id, i) => [id, r.avg[i]]));
  assert.ok(avg.tft > avg.alld);
  assert.ok(avg.grudger > avg.allc);
  const i = r.ids.indexOf('alld');
  assert.equal(r.wins[i] + r.draws[i], (defs.length - 1) * 3);
  assert.equal(r.score[0][1], 99 / 100);
});

test('replicator: ALLD takes over suckers', () => {
  const defs = [B.alld, B.allc];
  const r = tournament(defs, { ...DEFAULT_SETTINGS, rounds: 50, reps: 1 });
  const h = replicator(r.score, [0.5, 0.5], 100);
  assert.ok(h.at(-1)[0] > 0.99);
});

test('payoff checks', () => {
  assert.deepEqual(checkPayoff({ T: 5, R: 3, P: 1, S: 0 }), []);
  assert.equal(checkPayoff({ T: 3, R: 5, P: 1, S: 0 }).length, 1);
  assert.equal(checkPayoff({ T: 10, R: 3, P: 1, S: 0 }).length, 1);
});

test('psych traits make sense', () => {
  const tft = psych(B.tft);
  assert.equal(tft.nice, 1);
  assert.equal(tft.provocable, 1);
  assert.equal(tft.forgiving, 1);
  assert.ok(tft.spine > 0.95);
  const grim = psych(B.grudger);
  assert.equal(grim.forgiving, 0);
  const allc = psych(B.allc);
  assert.equal(allc.spine, 0);
  assert.ok(psych(B.pavlov).calm > psych(B.tft).calm);
});

test('field test ranks', () => {
  const f = fieldTest(B.tft, DEFAULT_SETTINGS);
  assert.ok(f.rank >= 1 && f.rank <= f.of);
});

test('nowak-may: a lone defector among cooperators with b = 1.85 spreads', () => {
  const size = 21;
  let g = new Uint8Array(size * size);
  g[10 * size + 10] = 1;
  const b = 1.85;
  const pay = (me, other) => (other === 0 ? (me === 0 ? 1 : b) : 0);
  const scores = new Float64Array(g.length);
  g = spatialStep(g, size, pay, scores, { selfInteraction: true });
  assert.equal(g.reduce((a, x) => a + x, 0), 9);
});
