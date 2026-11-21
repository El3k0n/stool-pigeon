// Runs tournaments off the main thread so the page stays responsive.
import { tournament } from './engine.js';

self.onmessage = (e) => {
  const { id, defs, settings } = e.data;
  try {
    const result = tournament(defs, settings, (progress) => self.postMessage({ id, progress }));
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
