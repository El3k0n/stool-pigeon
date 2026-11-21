// Pigeon script: the little language strategies are written in.
//
// Why a language of our own: the site's Content-Security-Policy forbids eval and
// new Function, and strategies arrive from share links written by strangers.
// So source is parsed here and compiled into plain closures. There are no loops,
// no recursion and no access to anything but the match, so every program ends
// in a handful of steps and cannot touch the page.
//
//   -- comment
//   memory grudge = false          persists between rounds of one match
//   if their.last == D then        if / elseif / else / end
//     grudge = true
//   end
//   if grudge then return D end
//   return C                        falling off the end also means C

export class LangError extends Error {
  constructor(message, line = 0, col = 0) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

const KEYWORDS = new Set([
  'if', 'then', 'elseif', 'else', 'end', 'return', 'and', 'or', 'not', 'memory', 'true', 'false',
]);

// ---------------------------------------------------------------- lexer

function lex(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const push = (type, value, l, c, len) => toks.push({ type, value, line: l, col: c, pos: i - len, len });

  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { i++; line++; col = 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; col++; continue; }
    if ((ch === '-' && src[i + 1] === '-') || ch === '#') {
      while (i < src.length && src[i] !== '\n') { i++; col++; }
      continue;
    }
    const l = line;
    const c = col;
    if (ch >= '0' && ch <= '9') {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i));
      i += m[0].length; col += m[0].length;
      push('num', Number(m[0]), l, c, m[0].length);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      i += m[0].length; col += m[0].length;
      push(KEYWORDS.has(m[0]) ? m[0] : 'ident', m[0], l, c, m[0].length);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '~=') {
      i += 2; col += 2;
      push(two === '~=' ? '!=' : two, two, l, c, 2);
      continue;
    }
    if ('+-*/%<>=()[],.;'.includes(ch)) {
      i++; col++;
      push(ch, ch, l, c, 1);
      continue;
    }
    throw new LangError(`Unexpected character "${ch}"`, l, c);
  }
  toks.push({ type: 'eof', value: '', line, col, pos: i, len: 0 });
  return toks;
}

// ---------------------------------------------------------------- parser

function parse(src) {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const at = (type) => toks[p].type === type;
  const accept = (type) => (at(type) ? next() : null);
  const expect = (type, what) => {
    if (at(type)) return next();
    const t = peek();
    const got = t.type === 'eof' ? 'the end of the script' : `"${t.value}"`;
    throw new LangError(`Expected ${what || `"${type}"`} but found ${got}`, t.line, t.col);
  };

  function block(stops) {
    const body = [];
    while (!stops.includes(peek().type)) {
      if (at('eof')) {
        const t = peek();
        throw new LangError(`Missing "end"`, t.line, t.col);
      }
      body.push(statement());
    }
    return body;
  }

  function statement() {
    const t = peek();
    if (accept(';')) return { kind: 'nop' };
    if (accept('memory')) {
      const decls = [];
      do {
        const name = expect('ident', 'a name');
        expect('=', '"=" after the memory name');
        decls.push({ name: name.value, init: expr(), line: name.line, col: name.col });
      } while (accept(','));
      return { kind: 'memory', decls, line: t.line, col: t.col };
    }
    if (accept('if')) {
      const branches = [];
      let cond = expr();
      expect('then', '"then"');
      branches.push({ cond, body: block(['elseif', 'else', 'end']) });
      let otherwise = null;
      for (;;) {
        if (accept('elseif')) {
          cond = expr();
          expect('then', '"then"');
          branches.push({ cond, body: block(['elseif', 'else', 'end']) });
        } else if (accept('else')) {
          otherwise = block(['end']);
        } else break;
      }
      expect('end', '"end" to close the if');
      return { kind: 'if', branches, otherwise, line: t.line, col: t.col };
    }
    if (accept('return')) {
      return { kind: 'return', value: expr(), line: t.line, col: t.col };
    }
    if (at('ident') && toks[p + 1].type === '=') {
      const name = next();
      next();
      return { kind: 'assign', name: name.value, value: expr(), line: name.line, col: name.col };
    }
    if (at('ident') && toks[p + 1].type === '==') {
      // Common slip: "x == 1" on its own line.
      throw new LangError(`"==" compares; use "=" to assign`, toks[p + 1].line, toks[p + 1].col);
    }
    const got = t.type === 'eof' ? 'the end of the script' : `"${t.value}"`;
    throw new LangError(`Expected a statement (if, return, memory or name = value) but found ${got}`, t.line, t.col);
  }

  function expr() { return orExpr(); }
  function bin(op, left, right, t) { return { kind: 'bin', op, left, right, line: t.line, col: t.col }; }
  function orExpr() {
    let left = andExpr();
    for (let t; (t = accept('or'));) left = bin('or', left, andExpr(), t);
    return left;
  }
  function andExpr() {
    let left = notExpr();
    for (let t; (t = accept('and'));) left = bin('and', left, notExpr(), t);
    return left;
  }
  function notExpr() {
    const t = accept('not');
    if (t) return { kind: 'not', value: notExpr(), line: t.line, col: t.col };
    return cmpExpr();
  }
  function cmpExpr() {
    const left = addExpr();
    const t = peek();
    if (['==', '!=', '<', '<=', '>', '>='].includes(t.type)) {
      next();
      return bin(t.type, left, addExpr(), t);
    }
    return left;
  }
  function addExpr() {
    let left = mulExpr();
    for (;;) {
      const t = peek();
      if (t.type !== '+' && t.type !== '-') return left;
      next();
      left = bin(t.type, left, mulExpr(), t);
    }
  }
  function mulExpr() {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t.type !== '*' && t.type !== '/' && t.type !== '%') return left;
      next();
      left = bin(t.type, left, unary(), t);
    }
  }
  function unary() {
    const t = accept('-');
    if (t) return { kind: 'neg', value: unary(), line: t.line, col: t.col };
    return postfix();
  }
  function args() {
    const list = [];
    if (!at(')')) {
      do list.push(expr()); while (accept(','));
    }
    expect(')', '")"');
    return list;
  }
  function postfix() {
    let node = primary();
    for (;;) {
      const t = peek();
      if (accept('.')) {
        const name = expect('ident', 'a property name after "."');
        if (accept('(')) node = { kind: 'method', target: node, name: name.value, args: args(), line: name.line, col: name.col };
        else node = { kind: 'prop', target: node, name: name.value, line: name.line, col: name.col };
      } else if (accept('[')) {
        const index = expr();
        expect(']', '"]"');
        node = { kind: 'index', target: node, index, line: t.line, col: t.col };
      } else if (node.kind === 'name' && at('(')) {
        next();
        node = { kind: 'call', name: node.name, args: args(), line: node.line, col: node.col };
      } else return node;
    }
  }
  function primary() {
    const t = next();
    switch (t.type) {
      case 'num': return { kind: 'num', value: t.value, line: t.line, col: t.col };
      case 'true': return { kind: 'bool', value: true, line: t.line, col: t.col };
      case 'false': return { kind: 'bool', value: false, line: t.line, col: t.col };
      case 'ident': return { kind: 'name', name: t.value, line: t.line, col: t.col };
      case '(': {
        const e = expr();
        expect(')', '")"');
        return e;
      }
      default: {
        const got = t.type === 'eof' ? 'the end of the script' : `"${t.value}"`;
        throw new LangError(`Expected a value but found ${got}`, t.line, t.col);
      }
    }
  }

  const body = [];
  while (!at('eof')) body.push(statement());
  return body;
}

// ---------------------------------------------------------------- runtime helpers

const MOVE = ['C', 'D'];

function typeName(v) {
  if (v === null || v === undefined) return 'none';
  if (v === 'C' || v === 'D') return 'a move';
  if (typeof v === 'boolean') return 'true/false';
  return 'a number';
}
function fail(node, msg) { throw new LangError(msg, node.line, node.col); }
function num(v, node, what) {
  if (typeof v !== 'number') fail(node, `${what} needs a number, got ${typeName(v)}`);
  return v;
}
function bool(v, node, what) {
  if (typeof v !== 'boolean') fail(node, `${what} needs true/false, got ${typeName(v)}`);
  return v;
}
function move(v, node, what) {
  if (v !== 'C' && v !== 'D') fail(node, `${what} needs C or D, got ${typeName(v)}`);
  return v;
}

// History objects (`my`, `their`) are provided by the engine:
//   { m: Uint8Array of moves (0 = C, 1 = D), n, coop, def, score, pay: Float64Array of payoffs }
const PROPS = {
  last: (h) => (h.n ? MOVE[h.m[h.n - 1]] : null),
  first: (h) => (h.n ? MOVE[h.m[0]] : null),
  moves: (h) => h.n,
  cooperations: (h) => h.coop,
  defections: (h) => h.def,
  score: (h) => h.score,
  payoff: (h) => (h.n ? h.pay[h.n - 1] : null),
  streak: (h) => {
    if (!h.n) return 0;
    const last = h.m[h.n - 1];
    let k = 1;
    while (k < h.n && h.m[h.n - 1 - k] === last) k++;
    return k;
  },
};

const METHODS = {
  count: { min: 1, max: 2, fn(h, a, node) {
    const m = move(a[0], node, 'count(move)') === 'C' ? 0 : 1;
    if (a.length === 1) return m ? h.def : h.coop;
    const k = Math.max(0, Math.min(h.n, Math.floor(num(a[1], node, 'count(move, rounds)'))));
    let c = 0;
    for (let i = h.n - k; i < h.n; i++) if (h.m[i] === m) c++;
    return c;
  } },
  rate: { min: 1, max: 2, fn(h, a, node) {
    const m = move(a[0], node, 'rate(move)') === 'C' ? 0 : 1;
    let k = h.n;
    if (a.length === 2) k = Math.max(0, Math.min(h.n, Math.floor(num(a[1], node, 'rate(move, rounds)'))));
    if (!k) return 0;
    let c = 0;
    for (let i = h.n - k; i < h.n; i++) if (h.m[i] === m) c++;
    return c / k;
  } },
  ever: { min: 1, max: 1, fn(h, a, node) {
    return (move(a[0], node, 'ever(move)') === 'C' ? h.coop : h.def) > 0;
  } },
  at: { min: 1, max: 1, fn(h, a, node) {
    const k = Math.floor(num(a[0], node, 'at(round)'));
    return k >= 1 && k <= h.n ? MOVE[h.m[k - 1]] : null;
  } },
};

const FUNCS = {
  random: { min: 0, max: 0, fn: (ctx) => ctx.v.rng() },
  chance: { min: 1, max: 1, fn: (ctx, a, node) => ctx.v.rng() < num(a[0], node, 'chance(p)') },
  mix: { min: 1, max: 1, fn: (ctx, a, node) => (ctx.v.rng() < num(a[0], node, 'mix(p)') ? 'C' : 'D') },
  flip: { min: 1, max: 1, fn: (ctx, a, node) => (move(a[0], node, 'flip(move)') === 'C' ? 'D' : 'C') },
  min: { min: 2, max: 2, fn: (ctx, a, node) => Math.min(num(a[0], node, 'min'), num(a[1], node, 'min')) },
  max: { min: 2, max: 2, fn: (ctx, a, node) => Math.max(num(a[0], node, 'max'), num(a[1], node, 'max')) },
  abs: { min: 1, max: 1, fn: (ctx, a, node) => Math.abs(num(a[0], node, 'abs')) },
  floor: { min: 1, max: 1, fn: (ctx, a, node) => Math.floor(num(a[0], node, 'floor')) },
};

const CONSTANTS = {
  C: () => 'C',
  D: () => 'D',
  none: () => null,
  round: (ctx) => ctx.v.round,
  T: (ctx) => ctx.v.payoff.T,
  R: (ctx) => ctx.v.payoff.R,
  P: (ctx) => ctx.v.payoff.P,
  S: (ctx) => ctx.v.payoff.S,
};

const RESERVED = new Set([
  ...Object.keys(CONSTANTS), ...Object.keys(FUNCS), 'my', 'their',
]);

// ---------------------------------------------------------------- compiler

export function compile(src) {
  const ast = parse(src);
  const memory = new Map();   // name -> slot
  const locals = new Set();
  const memInits = [];

  // First pass: collect names so we can report typos at compile time.
  (function scan(stmts, top) {
    for (const s of stmts) {
      if (s.kind === 'memory') {
        if (!top) fail(s, `"memory" goes at the top level, not inside an if`);
        for (const d of s.decls) {
          if (RESERVED.has(d.name)) fail(d, `"${d.name}" is a built-in name; pick another`);
          if (memory.has(d.name)) fail(d, `"${d.name}" is already in memory`);
          memory.set(d.name, memory.size);
        }
      } else if (s.kind === 'assign') {
        if (RESERVED.has(s.name)) fail(s, `"${s.name}" is built in and cannot be changed`);
        if (!memory.has(s.name)) locals.add(s.name);
      } else if (s.kind === 'if') {
        for (const b of s.branches) scan(b.body, false);
        if (s.otherwise) scan(s.otherwise, false);
      }
    }
  })(ast, true);
  for (const name of memory.keys()) locals.delete(name);

  function history(node) {
    if (node.kind !== 'name' || (node.name !== 'my' && node.name !== 'their')) {
      fail(node, `Only "my" and "their" have properties`);
    }
    return node.name === 'my' ? (ctx) => ctx.v.my : (ctx) => ctx.v.their;
  }

  function cexpr(node) {
    switch (node.kind) {
      case 'num': { const v = node.value; return () => v; }
      case 'bool': { const v = node.value; return () => v; }
      case 'name': {
        const n = node.name;
        if (CONSTANTS[n]) return CONSTANTS[n];
        if (memory.has(n)) { const slot = memory.get(n); return (ctx) => ctx.mem[slot]; }
        if (locals.has(n)) {
          return (ctx) => {
            if (!(n in ctx.loc)) fail(node, `"${n}" has no value yet in this round`);
            return ctx.loc[n];
          };
        }
        if (n === 'my' || n === 'their') return fail(node, `"${n}" needs a property, like ${n}.last`);
        if (FUNCS[n]) return fail(node, `"${n}" is a function: write ${n}(...)`);
        if (n === 'c' || n === 'd') return fail(node, `Moves are uppercase: ${n.toUpperCase()}`);
        return fail(node, `Unknown name "${n}"`);
      }
      case 'prop': {
        const h = history(node.target);
        const get = PROPS[node.name];
        if (!get) fail(node, `Unknown property "${node.name}". Try last, first, moves, cooperations, defections, score, payoff, streak`);
        return (ctx) => get(h(ctx));
      }
      case 'method': {
        const h = history(node.target);
        const m = METHODS[node.name];
        if (!m) fail(node, `Unknown method "${node.name}". Try count, rate, ever, at`);
        if (node.args.length < m.min || node.args.length > m.max) fail(node, `${node.name}() takes ${m.min === m.max ? m.min : `${m.min} or ${m.max}`} argument${m.max > 1 ? 's' : ''}`);
        const args = node.args.map(cexpr);
        return (ctx) => m.fn(h(ctx), args.map((a) => a(ctx)), node);
      }
      case 'index': {
        const h = history(node.target);
        const idx = cexpr(node.index);
        // their[1] is the last move, their[2] the one before, ...
        return (ctx) => {
          const hh = h(ctx);
          const k = Math.floor(num(idx(ctx), node, 'History index'));
          return k >= 1 && k <= hh.n ? MOVE[hh.m[hh.n - k]] : null;
        };
      }
      case 'call': {
        const f = FUNCS[node.name];
        if (!f) {
          if (PROPS[node.name] || METHODS[node.name]) fail(node, `"${node.name}" belongs to my or their: their.${node.name}`);
          fail(node, `Unknown function "${node.name}"`);
        }
        if (node.args.length < f.min || node.args.length > f.max) fail(node, `${node.name}() takes ${f.min === f.max ? f.min : `${f.min} to ${f.max}`} argument${f.max === 1 ? '' : 's'}`);
        const args = node.args.map(cexpr);
        return (ctx) => f.fn(ctx, args.map((a) => a(ctx)), node);
      }
      case 'not': {
        const v = cexpr(node.value);
        return (ctx) => !bool(v(ctx), node, '"not"');
      }
      case 'neg': {
        const v = cexpr(node.value);
        return (ctx) => -num(v(ctx), node, '"-"');
      }
      case 'bin': {
        const a = cexpr(node.left);
        const b = cexpr(node.right);
        switch (node.op) {
          case 'and': return (ctx) => bool(a(ctx), node, '"and"') && bool(b(ctx), node, '"and"');
          case 'or': return (ctx) => bool(a(ctx), node, '"or"') || bool(b(ctx), node, '"or"');
          case '==': return (ctx) => a(ctx) === b(ctx);
          case '!=': return (ctx) => a(ctx) !== b(ctx);
          case '<': return (ctx) => num(a(ctx), node, '"<"') < num(b(ctx), node, '"<"');
          case '<=': return (ctx) => num(a(ctx), node, '"<="') <= num(b(ctx), node, '"<="');
          case '>': return (ctx) => num(a(ctx), node, '">"') > num(b(ctx), node, '">"');
          case '>=': return (ctx) => num(a(ctx), node, '">="') >= num(b(ctx), node, '">="');
          case '+': return (ctx) => num(a(ctx), node, '"+"') + num(b(ctx), node, '"+"');
          case '-': return (ctx) => num(a(ctx), node, '"-"') - num(b(ctx), node, '"-"');
          case '*': return (ctx) => num(a(ctx), node, '"*"') * num(b(ctx), node, '"*"');
          case '/': return (ctx) => {
            const d = num(b(ctx), node, '"/"');
            if (d === 0) fail(node, 'Division by zero');
            return num(a(ctx), node, '"/"') / d;
          };
          case '%': return (ctx) => {
            const d = num(b(ctx), node, '"%"');
            if (d === 0) fail(node, 'Division by zero');
            const x = num(a(ctx), node, '"%"');
            return ((x % d) + d) % d;
          };
        }
      }
    }
    fail(node, 'Cannot compile this');
  }

  // A statement returns undefined to carry on, or a move to stop.
  function cblock(stmts) {
    const fns = [];
    for (const s of stmts) {
      if (s.kind === 'nop') continue;
      if (s.kind === 'memory') {
        for (const d of s.decls) memInits.push({ slot: memory.get(d.name), init: cexpr(d.init) });
        continue;
      }
      fns.push(cstmt(s));
    }
    return (ctx) => {
      for (let i = 0; i < fns.length; i++) {
        const r = fns[i](ctx);
        if (r !== undefined) return r;
      }
      return undefined;
    };
  }

  function cstmt(s) {
    switch (s.kind) {
      case 'return': {
        const v = cexpr(s.value);
        return (ctx) => move(v(ctx), s, '"return"');
      }
      case 'assign': {
        const v = cexpr(s.value);
        if (memory.has(s.name)) {
          const slot = memory.get(s.name);
          return (ctx) => { ctx.mem[slot] = v(ctx); };
        }
        const n = s.name;
        return (ctx) => { ctx.loc[n] = v(ctx); };
      }
      case 'if': {
        const branches = s.branches.map((b) => ({ cond: cexpr(b.cond), body: cblock(b.body), node: b.cond }));
        const otherwise = s.otherwise ? cblock(s.otherwise) : null;
        return (ctx) => {
          for (const b of branches) {
            if (bool(b.cond(ctx), b.node, '"if"')) return b.body(ctx);
          }
          return otherwise ? otherwise(ctx) : undefined;
        };
      }
    }
    fail(s, 'Cannot compile this statement');
  }

  const main = cblock(ast);
  const memSize = memory.size;

  return {
    // One instance per match: memory starts fresh.
    instance() {
      const ctx = { v: null, mem: new Array(memSize).fill(null), loc: Object.create(null) };
      let started = false;
      return {
        move(view) {
          ctx.v = view;
          if (!started) {
            started = true;
            for (const m of memInits) ctx.mem[m.slot] = m.init(ctx);
          }
          ctx.loc = Object.create(null);
          const r = main(ctx);
          return r === 'D' ? 1 : 0;
        },
      };
    },
  };
}

// Tokens for syntax highlighting. Never throws: unknown characters become "error".
export function highlightTokens(src) {
  const out = [];
  const re = /(--[^\n]*|#[^\n]*)|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|~=|<=|>=|[+\-*/%<>=()[\],.;])|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(src))) {
    let type = 'plain';
    if (m[1]) type = 'comment';
    else if (m[2]) type = 'num';
    else if (m[3]) {
      const w = m[3];
      if (KEYWORDS.has(w)) type = w === 'true' || w === 'false' ? 'const' : 'kw';
      else if (w === 'C') type = 'coop';
      else if (w === 'D') type = 'defect';
      else if (w === 'my' || w === 'their') type = 'hist';
      else if (RESERVED.has(w)) type = 'builtin';
      else type = 'ident';
    } else if (m[4]) type = 'op';
    else if (m[6]) type = 'error';
    out.push({ type, text: m[0] });
  }
  return out;
}
