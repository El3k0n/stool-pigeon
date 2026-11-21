import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, LangError, highlightTokens } from '../js/lang.js';
import { rng } from '../js/engine.js';

function hist(moves) {
  const m = Uint8Array.from(moves.map((x) => (x === 'D' ? 1 : 0)));
  const def = moves.filter((x) => x === 'D').length;
  return { m, pay: new Float64Array(moves.length).fill(3), n: moves.length, coop: moves.length - def, def, score: 3 * moves.length };
}
function view(my, their, extra = {}) {
  return { round: my.length + 1, my: hist(my), their: hist(their), rng: rng(1), payoff: { T: 5, R: 3, P: 1, S: 0 }, ...extra };
}
const run = (src, my, their) => (compile(src).instance().move(view(my, their)) ? 'D' : 'C');

test('tit for tat', () => {
  const src = 'if round == 1 then return C end\nreturn their.last';
  assert.equal(run(src, [], []), 'C');
  assert.equal(run(src, ['C'], ['D']), 'D');
  assert.equal(run(src, ['C', 'D'], ['D', 'C']), 'C');
});

test('history indexing and methods', () => {
  assert.equal(run('if their[2] == D then return D end return C', ['C', 'C'], ['D', 'C']), 'D');
  assert.equal(run('if their[3] == none then return D end return C', ['C', 'C'], ['D', 'C']), 'D');
  assert.equal(run('if their.count(D, 2) == 1 then return D end return C', ['C', 'C', 'C'], ['D', 'D', 'C']), 'D');
  assert.equal(run('if their.rate(D) > 0.5 then return D end return C', ['C', 'C', 'C'], ['D', 'D', 'C']), 'D');
  assert.equal(run('if their.at(1) == D and my.streak == 3 then return D end return C', ['C', 'C', 'C'], ['D', 'C', 'C']), 'D');
  assert.equal(run('if their.ever(D) then return D end return C', ['C'], ['C']), 'C');
});

test('memory persists, locals do not', () => {
  const p = compile('memory n = 0\nn = n + 1\nif n >= 3 then return D end\nreturn C').instance();
  const v = view([], []);
  assert.deepEqual([p.move(v), p.move(v), p.move(v)], [0, 0, 1]);
  const q = compile('x = 1\nif round > 1 then x = x + 1 end\nif x == 2 then return D end').instance();
  assert.equal(q.move(view([], [])), 0);
  assert.equal(q.move(view(['C'], ['C'])), 1);
  assert.equal(q.move(view(['C', 'C'], ['C', 'C'])), 1);
});

test('elseif / else / precedence', () => {
  const src = 'if round == 1 then return D elseif round == 2 then return C else return D end';
  assert.equal(run(src, [], []), 'D');
  assert.equal(run(src, ['C'], ['C']), 'C');
  assert.equal(run(src, ['C', 'C'], ['C', 'C']), 'D');
  assert.equal(run('if 1 + 2 * 3 == 7 and not (2 > 3) then return D end', [], []), 'D');
  assert.equal(run('if -3 % 5 == 2 then return D end', [], []), 'D');
});

test('compile errors carry a position', () => {
  const bad = [
    ['return X', 1, 8, /Unknown name "X"/],
    ['if round == 1 return C end', 1, 15, /Expected "then"/],
    ['if true then return C', 1, 22, /Missing "end"/],
    ['return c', 1, 8, /uppercase/],
    ['round = 3', 1, 1, /built in/],
    ['return their.lats', 1, 14, /Unknown property/],
    ['if true then memory x = 1 end', 1, 14, /top level/],
    ['return C @', 1, 10, /Unexpected character/],
  ];
  for (const [src, line, col, msg] of bad) {
    assert.throws(() => compile(src), (e) => e instanceof LangError && e.line === line && e.col === col && msg.test(e.message), src);
  }
});

test('runtime type errors', () => {
  assert.throws(() => run('if their.last then return D end', ['C'], ['C']), /needs true\/false/);
  assert.throws(() => run('return 3', [], []), /needs C or D/);
  assert.throws(() => run('x = 1 / 0', [], []), /Division by zero/);
});

test('falling off the end cooperates', () => {
  assert.equal(run('x = 1', [], []), 'C');
});

test('highlighter never throws and keeps all text', () => {
  const src = 'memory a = 1 -- hi\nif their.last == D then return C end @';
  assert.equal(highlightTokens(src).map((t) => t.text).join(''), src);
});
