// Viewport screenshot in headless Chrome.
//
//   node dev/shot.mjs <url> <out.png> [--width 1200] [--height 630] [--scale 1] [--eval "js to run first"] [--wait 1500]
//
// assets/og.png is the intro with the copy hidden:
//   node dev/shot.mjs http://localhost:8800/dilemma/ assets/og.png \
//     --eval "document.querySelectorAll('.hero__lede, .hero__actions').forEach((e) => { e.hidden = true; })"

import { writeFileSync } from 'node:fs';
import { openPage, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const takesValue = ['--width', '--height', '--scale', '--eval', '--wait'];
const [url, out] = args.filter((a, i) => !a.startsWith('--') && !takesValue.includes(args[i - 1]));
if (!url || !out) {
  console.error('usage: node dev/shot.mjs <url> <out.png> [--width W] [--height H] [--scale S] [--transparent] [--eval JS] [--wait MS]');
  process.exit(2);
}

const width = Number(option('--width', 1200));
const height = Number(option('--height', 630));
const page = await openPage({ width, height, scale: Number(option('--scale', 1)), transparent: args.includes('--transparent') });
await page.goto(url, Number(option('--wait', 1500)));
const script = option('--eval', '');
if (script) {
  await page.evaluate(script);
  await sleep(500);
}
writeFileSync(out, await page.screenshot());
page.close();
console.log(`${out} (${width}×${height})`);
process.exit(0);
