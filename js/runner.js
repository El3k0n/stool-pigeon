// Tournament runner: a module worker when the browser has one, the main thread otherwise.
import { tournament } from './engine.js';

let worker = null;
let failed = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      if (e.data.progress !== undefined) job.onProgress?.(e.data.progress);
      else {
        pending.delete(e.data.id);
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data.result);
      }
    };
    worker.onerror = () => {
      failed = true;
      worker = null;
      for (const job of pending.values()) job.fallback();
      pending.clear();
    };
  } catch {
    failed = true;
    worker = null;
  }
  return worker;
}

const plain = (defs) => defs.map(({ id, name, source }) => ({ id, name, source }));

export function runTournament(defs, settings, onProgress) {
  const list = plain(defs);
  return new Promise((resolve, reject) => {
    const local = () => {
      setTimeout(() => {
        try { resolve(tournament(list, settings, onProgress)); } catch (err) { reject(err); }
      }, 30);
    };
    const w = getWorker();
    if (!w) { local(); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress, fallback: local });
    w.postMessage({ id, defs: list, settings });
  });
}
