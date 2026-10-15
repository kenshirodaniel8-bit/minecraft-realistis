// Single-player without a server: the real game server (server/game.js) runs
// inside the page, and this class stands in for the Socket.IO connection.
// It has the same interface as Net (net.js), so the rest of the client does
// not know the difference. Saves go to localStorage (browserStore.js).

import { CONFIG, PROTOCOL_VERSION } from '#shared/config.js';
import { randomId } from '#shared/rng.js';
import { BrowserStore } from './browserStore.js';
import { steadyInterval } from './steadyTimer.js';

const SID = 'local';
// messages are copied like a real network would, so client and server never
// share objects
const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class LocalNet {
  constructor() {
    this.local = true;
    this.socket = null;
    this.offset = 0;
    this.rtt = 0;
    this.handlers = new Map();
    this.connected = false;
  }

  async connect() {
    const { Game } = await import('#server/game.js');
    const dev = new URLSearchParams(location.search).has('dev');
    this.game = new Game({
      store: new BrowserStore(),
      devCommands: dev,
      // alone in your browser: the expansion islands are open from the start
      // (they still need the usual player level)
      expansionThresholds: [0, 0],
      log: (...a) => console.log('[game]', ...a),
    });
    await this.game.init();
    const step = 1000 / CONFIG.tickRate;
    let last = performance.now();
    this.stopTimer = steadyInterval(() => {
      const t = performance.now();
      const dt = Math.min(200, t - last);
      last = t;
      try {
        this.game.tick(dt);
      } catch (e) {
        console.error('[game] tick error', e);
      }
    }, step);
    // save when the tab is hidden or closed
    const flush = () => this.game.flushSaves();
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    this.socket = { local: true };
    this.connected = true;
    this.emitLocal('connect');
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emitLocal(event, data) {
    const list = this.handlers.get(event);
    if (list) for (const fn of list) {
      try {
        fn(data);
      } catch (e) {
        console.error(`handler for ${event} failed`, e);
      }
    }
  }

  async hello(token, name, color) {
    const deliver = (event, data) => {
      const d = copy(data);
      queueMicrotask(() => this.emitLocal(event, d));
    };
    const transport = { closed: false, send: deliver, sendVolatile: deliver, disconnect() {} };
    const res = await this.game.join(SID, { protocol: PROTOCOL_VERSION, token, name, color }, transport);
    if (res.ok) {
      const s = this.game.players.get(SID);
      if (s && s.offlineEarned) {
        this.game.toast(s, `Your monsters earned ${s.offlineEarned} Money while you were away! Collect it at your base.`, 'good');
        s.offlineEarned = 0;
      }
    }
    return copy(res);
  }

  send(type, payload) {
    if (this.connected && this.game.handlers[type]) this.game.handle(SID, type, copy(payload));
  }

  request(type, payload = {}) {
    if (!this.connected) return Promise.resolve({ ok: false, error: 'offline', message: 'Not connected.' });
    if (!this.game.handlers[type]) return Promise.resolve({ ok: false, error: 'unknown' });
    if (!payload.reqId) payload = { ...payload, reqId: randomId('r', 10) };
    return Promise.resolve(copy(this.game.handle(SID, type, copy(payload)) || { ok: true }));
  }

  async syncClock() {}

  serverNow() {
    return Date.now();
  }
}
