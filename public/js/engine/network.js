// WebSocket client for multiplayer.

export const PROTOCOL_VERSION = 1;

export function defaultServerUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.host) return `${proto}//${location.host}/ws`;
  return 'ws://localhost:3000/ws';
}

// Accepts "host", "host:port", "ws://host:port/ws", "http://host:port" ...
export function normalizeServerUrl(input) {
  let s = String(input || '').trim();
  if (!s) return defaultServerUrl();
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(s)) {
    const secure = location.protocol === 'https:';
    s = (secure ? 'wss://' : 'ws://') + s;
  }
  try {
    const u = new URL(s);
    if (!u.pathname || u.pathname === '/') u.pathname = '/ws';
    return u.toString();
  } catch (e) {
    throw new Error('That server address is not valid.');
  }
}

export class NetworkClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.closed = false;
    this.onClose = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  connect(hello, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(val);
      };
      const timer = setTimeout(() => {
        done(new Error('Connection timed out. Is the server running?'));
        try { this.ws && this.ws.close(); } catch (e) { /* ignore */ }
      }, timeoutMs);
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        done(new Error('Could not connect: ' + e.message));
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.send(Object.assign({ t: 'hello', v: PROTOCOL_VERSION }, hello));
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        if (!settled) {
          if (msg.t === 'welcome') { done(null, msg); return; }
          if (msg.t === 'error') { done(new Error(msg.message || 'Server refused the connection.')); return; }
        }
        const hs = this.handlers.get(msg.t);
        if (hs) for (const h of hs) {
          try { h(msg); } catch (err) { console.error('Handler error for', msg.t, err); }
        }
      };
      ws.onerror = () => {
        done(new Error('Could not connect to ' + this.url));
      };
      ws.onclose = (ev) => {
        if (!settled) done(new Error('Connection closed by server.'));
        if (!this.closed && this.onClose) this.onClose(ev.reason || 'Disconnected from server.');
        this.closed = true;
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
    }
  }

  close() {
    this.closed = true;
    try { this.ws && this.ws.close(); } catch (e) { /* ignore */ }
  }
}
