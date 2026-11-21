// Smoke test: opens every section in headless Chrome under the production CSP,
// presses the main buttons, and fails on any console error, uncaught exception
// or CSP violation.
//
//   python3 dev/serve.py &
//   node dev/smoke.mjs [base-url] [--width 1280] [--shots DIR]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPage, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = args.find((a) => a.startsWith('http')) || 'http://localhost:8800/dilemma/';
const WIDTH = Number(option('--width', 1280));
const SHOTS = option('--shots', null);

const page = await openPage({ width: WIDTH, height: WIDTH < 600 ? 844 : 900, mobile: WIDTH < 600 });
const problems = [];

page.on((msg) => {
  const { method, params } = msg;
  if (method === 'Page.javascriptDialogOpening') page.call('Page.handleJavaScriptDialog', { accept: true });
  if (method === 'Runtime.exceptionThrown') problems.push(`exception: ${params.exceptionDetails.exception?.description || params.exceptionDetails.text}`);
  if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) {
    problems.push(`console.${params.type}: ${params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
  if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) {
    problems.push(`${params.entry.level}: ${params.entry.text} ${params.entry.url || ''}`);
  }
});
await page.call('Runtime.enable');
await page.call('Log.enable');

const $ = (sel) => JSON.stringify(sel);
const click = (sel) => page.evaluate(`(() => {
  const el = document.querySelector(${$(sel)});
  if (!el) throw new Error('no element ' + ${$(sel)});
  el.click();
})()`);
const type = (sel, value) => page.evaluate(`(() => {
  const el = document.querySelector(${$(sel)});
  el.value = ${$(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const expect = async (what, expr) => {
  if (!(await page.evaluate(expr))) problems.push(`expected: ${what}`);
};
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${name}-${WIDTH}.png`), await page.screenshot({ fullPage: true }));
};
const waitFor = async (expr, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await page.evaluate(expr)) return;
};

await page.goto(BASE, 1200);
await expect('intro visible', `!document.getElementById('view-intro').hidden`);
await expect('payoffs filled in', `document.querySelector('[data-text="pay-T"]').textContent === '5'`);
await shot('intro');

// Play until Mo says it's over, then guess.
// Evolution before any tournament: it has to run one by itself.
await page.goto(`${BASE}#evolution`, 300);
await waitFor(`document.querySelector('#view-evolution [data-el="gen"]').textContent !== 'Generation 0'`);
await expect('evolution runs its own tournament', `document.querySelector('#view-evolution [data-el="gen"]').textContent !== 'Generation 0'`);

await page.goto(`${BASE}#play`);
const over = `!document.querySelector('#view-play [data-el="end"]').hidden`;
for (let i = 0; i < 60 && !(await page.evaluate(over)); i++) {
  await click(`#view-play [data-action="${i % 3 ? 'play-c' : 'play-d'}"]`);
}
await expect('the game ends', over);
await click('#view-play [data-el="guess-list"] .chip');
await expect('comparison after the guess', `document.querySelectorAll('#view-play [data-el="compare"] .bar').length >= 6`);
await shot('play');

await page.goto(`${BASE}#duel?a=tft&b=alld`, 300);
await click('#view-duel [data-action="duel-instant"]');
await sleep(200);
await expect('duel scores', `document.querySelector('#view-duel [data-el="score-a"]').textContent === '149'`);
await shot('duel');

await page.goto(`${BASE}#tournament`, 300);
await click('#view-tournament [data-action="t-run"]');
await waitFor(`document.querySelector('#view-tournament [data-el="run"]').textContent === 'Run tournament'`);
await expect('15 rows on the leaderboard', `document.querySelectorAll('#view-tournament .board__row').length === 15`);
await expect('15 x 15 heatmap', `document.querySelectorAll('#view-tournament .heat__cell').length === 225`);
await shot('tournament');

await page.goto(`${BASE}#evolution`, 400);
await click('#view-evolution [data-action="evo-instant"]');
await sleep(300);
await expect('evolution summary', `document.querySelector('#view-evolution [data-el="insight"]').textContent.startsWith('After')`);
await shot('evolution');

await page.goto(`${BASE}#turf`, 300);
for (let i = 0; i < 30; i++) await click('#view-turf [data-action="turf-step"]');
await expect('30 generations', `document.querySelector('#view-turf [data-el="gen"]').textContent === 'Gen 30'`);
await shot('turf-classic');
await click('#view-turf [data-action="turf-mode"][data-value="strategies"]');
for (let i = 0; i < 10; i++) await click('#view-turf [data-action="turf-step"]');
await shot('turf-strategies');

// Lab: a broken script, then a working one, saved.
await page.goto(`${BASE}#lab`, 500);
await type('#view-lab [data-el="code"]', 'if round == 1 return C end');
await sleep(700);
await expect('compile error with a line number', `document.querySelector('#view-lab [data-el="status"]').textContent.includes('Line 1')`);
await type('#view-lab [data-el="code"]', 'memory hurt = 0\nif their.last == D then hurt = hurt + 1 end\nif hurt > 2 then return D end\nreturn C');
await type('#view-lab [data-el="name"]', 'Smoke Bird');
await sleep(800);
await expect('psych radar', `document.querySelectorAll('#view-lab .radar').length === 1`);
await expect('field test', `document.querySelectorAll('#view-lab [data-el="field"] .bar').length > 10`);
await click('#view-lab [data-action="lab-save"]');
await sleep(200);
await shot('lab');
await click('#view-lab [data-action="lab-mode"][data-value="dials"]');
await sleep(400);
await shot('lab-dials');

await page.goto(`${BASE}#guide`, 800);
await expect('22 classics plus the saved one', `document.querySelectorAll('#view-guide .card').length === 23`);
await shot('guide');

await click('[data-action="open-rules"]');
await type('#rules input[name="noise"]', '5');
await expect('rules summary follows the dialog', `document.querySelector('[data-text="rules-summary"]').textContent.includes('noise 5%')`);
await shot('rules');
await page.evaluate(`document.querySelector('#rules').close()`);

const link = await page.evaluate(`import('./js/store.js').then((m) => m.encodeShare({ name: 'Shared', source: 'return D' }))`);
await page.goto(`${BASE}#lab?share=${link}`);
await expect('share link loads into the lab', `document.querySelector('#view-lab [data-el="name"]').value === 'Shared'`);

await page.evaluate('localStorage.clear()');
page.close();

if (problems.length) {
  console.log(`FAIL at ${WIDTH}px\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`OK at ${WIDTH}px: every section works, no console errors, no CSP violations.`);
process.exit(0);
