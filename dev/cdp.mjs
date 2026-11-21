// Just enough of the Chrome DevTools Protocol to drive a headless page.
// Node's built-in WebSocket does the talking, so there is nothing to install.

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function openPage({ width = 1280, height = 900, mobile = false, scale = 1, transparent = false } = {}) {
  const flags = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'stool-pigeon-'))}`, '--remote-debugging-port=0',
  ];
  // CI runners don't allow Chrome's sandbox.
  if (process.env.CI) flags.push('--no-sandbox');
  const chrome = spawn(process.env.CHROME || MAC_CHROME, [...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let log = '';
    chrome.stderr.on('data', (d) => {
      log += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}): ${log.slice(-400)}`)));
    setTimeout(() => reject(new Error('Chrome did not start within 15s')), 15000);
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let lastId = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else listeners.forEach((fn) => fn(msg));
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++lastId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  if (transparent) await call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

  return {
    call,
    // Events from this page only.
    on(fn) { listeners.push((msg) => { if (msg.sessionId === sessionId) fn(msg); }); },
    async goto(url, wait = 600) {
      await call('Page.navigate', { url });
      await sleep(wait);
    },
    async evaluate(expression) {
      const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(`${expression}\n  -> ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      }
      return r.result.value;
    },
    async screenshot({ fullPage = false } = {}) {
      const params = { format: 'png' };
      if (fullPage) {
        const h = await this.evaluate('Math.min(document.documentElement.scrollHeight, 6000)');
        Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
      }
      const { data } = await call('Page.captureScreenshot', params);
      return Buffer.from(data, 'base64');
    },
    close() {
      ws.close();
      chrome.kill();
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
