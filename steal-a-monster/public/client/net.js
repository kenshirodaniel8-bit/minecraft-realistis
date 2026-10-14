// Socket.IO connection, request/acknowledgement helpers, server clock sync
// and snapshot interpolation buffers.

import { PROTOCOL_VERSION } from '#shared/config.js';
import { randomId } from '#shared/rng.js';

// requests that change money/ownership carry a request id so a retry after a
// network hiccup can never be applied twice on the server
const TRANSACTIONAL = new Set(['recruit', 'buySword', 'buyItem', 'buyUpgrade', 'buyDecor']);

export class Net {
  constructor() {
    this.socket = null;
    this.offset = 0;
    this.rtt = 100;
    this.handlers = new Map();
    this.connected = false;
  }

  async connect() {
    // loaded on demand: the single-player web build has no Socket.IO server
    const { io } = await import('/socket.io/socket.io.esm.min.js');
    this.socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 4000 });
    this.socket.on('connect', () => {
      this.connected = true;
      this.emitLocal('connect');
    });
    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.emitLocal('disconnect', reason);
    });
    this.socket.on('connect_error', (e) => this.emitLocal('connect_error', e));
    this.socket.onAny((event, data) => this.emitLocal(event, data));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Could not reach the game server.')), 8000);
      this.socket.once('connect', () => {
        clearTimeout(t);
        resolve();
      });
    });
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

  hello(token, name, color) {
    const t0 = Date.now();
    return new Promise((resolve) => {
      this.socket.timeout(15000).emit('hello', { protocol: PROTOCOL_VERSION, token, name, color }, (err, res) => {
        if (err) return resolve({ ok: false, message: 'The server did not answer.' });
        if (res && res.serverTime) {
          this.rtt = Date.now() - t0;
          this.offset = res.serverTime - (t0 + this.rtt / 2);
        }
        resolve(res);
      });
    });
  }

  send(type, payload) {
    if (this.connected) this.socket.emit(type, payload);
  }

  request(type, payload = {}, timeout = 5000) {
    if (TRANSACTIONAL.has(type) && !payload.reqId) payload = { ...payload, reqId: randomId('r', 10) };
    return new Promise((resolve) => {
      if (!this.connected) return resolve({ ok: false, error: 'offline', message: 'Not connected.' });
      this.socket.timeout(timeout).emit(type, payload, (err, res) => {
        if (err) {
          // retry once with the same request id (safe: the server deduplicates)
          if (TRANSACTIONAL.has(type) && !payload.retried) {
            return resolve(this.request(type, { ...payload, retried: true }, timeout));
          }
          return resolve({ ok: false, error: 'timeout', message: 'The server did not answer in time.' });
        }
        resolve(res || { ok: true });
      });
    });
  }

  async syncClock() {
    const t0 = Date.now();
    const res = await this.request('ping', {}, 3000);
    if (res && res.t) {
      const rtt = Date.now() - t0;
      const off = res.t - (t0 + rtt / 2);
      this.rtt = this.rtt * 0.7 + rtt * 0.3;
      this.offset = this.offset * 0.8 + off * 0.2;
    }
  }

  serverNow() {
    return Date.now() + this.offset;
  }
}

// Position buffer for smooth interpolation of other players and monsters.
export class InterpBuffer {
  constructor() {
    this.items = [];
  }

  push(t, x, y, z, yaw) {
    const last = this.items[this.items.length - 1];
    if (last && t <= last.t) return;
    this.items.push({ t, x, y, z, yaw });
    if (this.items.length > 8) this.items.shift();
  }

  sample(t, out) {
    const it = this.items;
    if (!it.length) return false;
    if (t <= it[0].t || it.length === 1) {
      Object.assign(out, it[0]);
      return true;
    }
    for (let i = it.length - 1; i > 0; i--) {
      const a = it[i - 1];
      const b = it[i];
      if (t >= a.t) {
        const span = b.t - a.t || 1;
        let k = (t - a.t) / span;
        k = Math.min(k, 1.5); // a little extrapolation when packets are late
        out.x = a.x + (b.x - a.x) * k;
        out.y = a.y + (b.y - a.y) * k;
        out.z = a.z + (b.z - a.z) * k;
        let dy = b.yaw - a.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        out.yaw = a.yaw + dy * Math.min(1, k);
        return true;
      }
    }
    Object.assign(out, it[0]);
    return true;
  }

  latest() {
    return this.items[this.items.length - 1];
  }
}
