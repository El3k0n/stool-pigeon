// Play: you against Mo, who runs a strategy he won't name. Then you guess.

import { Match, matchLength, mix, C, D, playMatch, BUILTIN_BY_ID } from '../engine.js';
import { getSettings, allStrategies, getStrategy, on } from '../store.js';
import { h, els, actions, fillStrategySelect, barList, crumbs } from '../ui.js';

const LINES = {
  start: ['Your move.', 'Well? I haven\'t got all day.', 'Go on then.'],
  cc: ['Fine. Crumbs for everyone.', 'Look at us. Civilised.', 'Don\'t get used to it.', 'Huh. Trust.'],
  dc: ['You... ratted me out?', 'Wow. Okay.', 'I\'ll remember that.', 'Cold.'],
  cd: ['Nothing personal.', 'Business is business.', 'Sucker.', 'Thanks for the crumbs.'],
  dd: ['Well, this is productive.', 'Two rats in a cage.', 'Scraps it is.', 'Happy now?'],
};
const POSE = {
  start: ['laptop', 'Mo, waiting for your move'],
  cc: ['laptop', 'Mo, unimpressed but fed'],
  dc: ['dead', 'Mo, flat on his back, betrayed'],
  cd: ['annoyed', 'Mo, looking smug'],
  dd: ['annoyed', 'Mo, glaring'],
  end: ['sign', 'Mo holding a sign: Done. Now leave.'],
};
// Who Mo can be. Left out: the ones that look like a twin of another in a short game.
const MYSTERY_POOL = ['tft', 'allc', 'alld', 'random', 'grudger', 'pavlov', 'gtft', 'tf2t', 'ttft', 'stft', 'softgrudger', 'gradual', 'joss', 'tester', 'prober', 'alternator', 'extort2', 'mo'];
const COMPARE = ['tft', 'alld', 'allc', 'pavlov', 'grudger', 'gtft'];

let root;
let $;
let state = null;
let games = 0;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function init(r) {
  root = r;
  $ = els(root);
  fillStrategySelect($.opponent, { value: 'mystery', extra: [{ value: 'mystery', label: 'Mystery pigeon' }] });
  on('strategies', () => fillStrategySelect($.opponent, { extra: [{ value: 'mystery', label: 'Mystery pigeon' }] }));
  $.opponent.addEventListener('change', () => newGame());

  actions(root, {
    'play-c': () => move(C),
    'play-d': () => move(D),
    'play-new': () => newGame(),
    'play-rematch': () => newGame(state.opponent.id),
  });

  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'c') move(C);
    if (k === 'd') move(D);
  });
  newGame();
}

export function show() {}

function newGame(forceId) {
  const choice = $.opponent.value;
  const id = forceId || (choice === 'mystery' ? pick(MYSTERY_POOL) : choice);
  const opponent = getStrategy(id) || BUILTIN_BY_ID.tft;
  const settings = getSettings();
  const seed = mix(settings.seed, 'play', games++, Date.now());
  // Short enough to play by hand, long enough to learn something. You don't get told.
  const length = Math.max(8, Math.min(40, matchLength({ rounds: 18, randomLength: true }, seed)));
  state = {
    opponent,
    settings,
    mystery: !forceId && choice === 'mystery',   // a rematch is no mystery any more
    seed,
    length,
    match: new Match(null, opponent, settings, { seed, length }),
    wants: [],
    guessed: null,
  };
  $['strip-you'].replaceChildren();
  $['strip-mo'].replaceChildren();
  $.end.hidden = true;
  $.buttons.hidden = false;
  say('start');
  render();
}

function move(m) {
  if (!state || state.match.done) return;
  const r = state.match.step(m);
  state.wants.push(m);
  addTile($['strip-you'], r.a, r.a !== r.wantA);
  addTile($['strip-mo'], r.b, r.b !== r.wantB);
  say(['cc', 'cd', 'dc', 'dd'][r.a * 2 + r.b]);
  render();
  if (state.match.done) finish();
}

function addTile(row, m, flipped) {
  const t = h('span', { class: `tile tile--${m ? 'd' : 'c'}${flipped ? ' tile--flip' : ''}`, title: `${m ? 'Rat' : 'Kept quiet'}${flipped ? ' (flipped by noise)' : ''}` });
  row.append(t);
}

function say(kind) {
  const [pose, alt] = POSE[kind];
  $.mo.src = `assets/pigeon-${pose}.png`;
  $.mo.alt = alt;
  $.mo.dataset.pose = pose;
  $.say.textContent = kind === 'end' ? 'Done. Now guess what I was running.' : pick(LINES[kind]);
}

function render() {
  const m = state.match;
  $['you-score'].textContent = crumbs(m.a.score);
  $['mo-score'].textContent = crumbs(m.b.score);
  $.round.textContent = String(Math.min(m.round + 1, m.length));
}


function finish() {
  say('end');
  $.buttons.hidden = true;
  $.end.hidden = false;
  const m = state.match;
  const you = m.a.score;
  const mo = m.b.score;
  $['end-title'].textContent = you > mo ? 'You won. Technically.' : you < mo ? 'Mo wins.' : 'Dead heat.';
  $['end-text'].textContent = `${m.length} rounds. You: ${crumbs(you)} crumbs, Mo: ${crumbs(mo)}. You kept quiet ${Math.round((m.a.coop / m.length) * 100)}% of the time.`;
  $.guess.hidden = !state.mystery;
  $.reveal.hidden = state.mystery;
  if (state.mystery) {
    $['guess-list'].replaceChildren(...allStrategies().map((s) => h('button', {
      type: 'button',
      class: 'chip',
      text: s.name,
      onclick: () => reveal(s),
    })));
  } else reveal(null);
}

// Would `def`, facing exactly your moves and the same coin flips, have played exactly like Mo did?
function sameBehaviour(def) {
  const replay = new Match(null, def, state.settings, { seed: state.seed, length: state.length });
  for (const w of state.wants) replay.step(w);
  const a = state.match.b;
  const b = replay.b;
  for (let i = 0; i < a.n; i++) if (a.m[i] !== b.m[i]) return false;
  return true;
}

function reveal(guess) {
  $.guess.hidden = true;
  $.reveal.hidden = false;
  const opp = state.opponent;
  let text = `Mo was playing ${opp.name}. ${opp.blurb || ''}`;
  if (guess) {
    if (guess.id === opp.id) text = `Correct: ${opp.name}. Mo is impressed. Mo will not say so. ${opp.blurb || ''}`;
    else if (sameBehaviour(guess)) text = `It was ${opp.name}, not ${guess.name}. But against you ${guess.name} would have played move for move the same, so we'll allow it.`;
    else text = `Nope. You said ${guess.name}, it was ${opp.name}. ${opp.blurb || ''}`;
  }
  $['reveal-text'].textContent = text;
  $['end-duel'].href = `#duel?a=tft&b=${encodeURIComponent(opp.id)}`;

  const { settings } = state;
  const rows = COMPARE.map((id) => {
    const def = BUILTIN_BY_ID[id];
    const r = playMatch(def, opp, settings, { seed: state.seed, length: state.length });
    return { label: def.name, value: r.a.score, fill: allStrategies().find((s) => s.id === id)?.fill };
  });
  rows.push({ label: 'You', value: state.match.a.score, highlight: true });
  rows.sort((x, y) => y.value - x.value);
  barList($.compare, rows, { format: crumbs });
}
