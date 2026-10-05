// Background worker entry point (see worker-core.js for the actual work).

import { handleTask } from './worker-core.js';

self.onmessage = (e) => {
  const msg = e.data;
  try {
    const { result, transfers } = handleTask(msg);
    self.postMessage({ id: msg.id, ok: true, result }, transfers);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.stack || err) });
  }
};
