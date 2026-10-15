// Online rooms over Firebase Realtime Database (for the static web build,
// which has no game server).
//
// One player HOSTS: the real game server (server/game.js) already runs in
// their page (localNet.js). RoomHost relays it to the other players through
// Firebase. The others are GUESTS: RoomGuestNet has the same interface as
// Net (net.js), so the rest of the client does not know the difference.
// The host's game stays the only authority: guests only send "I moved / I
// swung / please recruit" messages, exactly like with the Node server.
//
// Database layout, under sam/rooms/{CODE}:
//   host                {v, at}         the host is online (removed when they leave)
//   guests/{gid}        {at}            a guest is online
//   up/{gid}/{push}     {j}             guest -> host messages (JSON text)
//   down/{gid}/{push}   {j}             host -> guest messages (JSON text)
// Messages travel as JSON text because the database drops nulls and empty
// arrays inside stored objects. Every message is deleted once it is read.

import { PROTOCOL_VERSION } from '#shared/config.js';
import { randomId } from '#shared/rng.js';
import { FIREBASE_CONFIG } from '../firebase-config.js';
import { steadyInterval } from './steadyTimer.js';

const ROOT = 'sam/rooms';
const DOWN_MS = 100; // host -> guest batches (10 a second)
const UP_MS = 60;   // guest -> host batches
const MOVE_MS = 50; // the host applies each guest's latest position this often
const TRANSACTIONAL = new Set(['recruit', 'buySword', 'buyItem', 'buyUpgrade', 'buyDecor']);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 mix-ups

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function cleanRoomCode(text) {
  const c = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 5 && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null;
}

// The config from firebase-config.js, or one saved in this browser (used by
// the automated tests to point at the local Firebase emulator).
export function firebaseConfig() {
  try {
    const o = JSON.parse(localStorage.getItem('sam_firebase') || 'null');
    if (o && o.databaseURL) return o;
  } catch { /* ignore */ }
  return FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL ? FIREBASE_CONFIG : null;
}

let fbPromise = null;
function firebase() {
  if (!fbPromise) {
    fbPromise = (async () => {
      const cfg = firebaseConfig();
      if (!cfg) throw new Error('Online play is not set up yet (firebase-config.js is empty).');
      const fb = await import('../vendor/firebase.js');
      const app = fb.initializeApp(cfg, 'steal-a-monster');
      const db = fb.getDatabase(app);
      if (cfg.emulator) {
        const [host, port] = String(cfg.emulator).split(':');
        fb.connectDatabaseEmulator(db, host, Number(port));
      }
      return { fb, db };
    })();
    fbPromise.catch(() => { fbPromise = null; });
  }
  return fbPromise;
}

const parse = (v) => {
  try {
    return v && typeof v.j === 'string' ? JSON.parse(v.j) : [];
  } catch {
    return [];
  }
};

// ------------------------------------------------------------------ host

export class RoomHost {
  constructor(game) {
    this.game = game;
    this.guests = new Map();
    this.code = null;
  }

  get guestCount() {
    let n = 0;
    for (const g of this.guests.values()) if (g.joined) n++;
    return n;
  }

  async open() {
    const { fb, db } = await firebase();
    this.fb = fb;
    this.db = db;
    // pick a code nobody is using right now
    for (let tries = 0; tries < 6 && !this.code; tries++) {
      const code = makeRoomCode();
      const taken = await fb.get(fb.ref(db, `${ROOT}/${code}/host`));
      if (!taken.exists()) this.code = code;
    }
    if (!this.code) throw new Error('Could not find a free room code. Try again.');
    this.room = fb.ref(db, `${ROOT}/${this.code}`);
    // the whole room disappears when the host goes away
    await fb.onDisconnect(this.room).remove();
    await fb.set(fb.child(this.room, 'host'), { v: PROTOCOL_VERSION, at: fb.serverTimestamp() });
    const guestsRef = fb.child(this.room, 'guests');
    this.unsubs = [
      fb.onChildAdded(guestsRef, (snap) => this.addGuest(snap.key)),
      fb.onChildRemoved(guestsRef, (snap) => this.dropGuest(snap.key)),
    ];
    // (worker timers: they keep going when the host's tab is in the background)
    this.stopTimers = [
      steadyInterval(() => this.flush(), DOWN_MS),
      steadyInterval(() => {
        for (const g of this.guests.values()) this.applyMove(g);
      }, MOVE_MS),
    ];
    return this.code;
  }

  addGuest(gid) {
    if (this.guests.has(gid) || !/^[A-Za-z0-9_-]{4,40}$/.test(gid)) return;
    const { fb } = this;
    const g = { gid, out: [], snap: null, move: null, joined: false };
    g.transport = {
      closed: false,
      send: (e, d) => this.queue(g, e, d),
      sendVolatile: (e, d) => this.queue(g, e, d),
      disconnect: () => this.kick(g),
    };
    g.unsub = fb.onChildAdded(fb.child(this.room, `up/${gid}`), (snap) => {
      const list = parse(snap.val());
      fb.remove(snap.ref);
      this.receive(g, list);
    });
    this.guests.set(gid, g);
  }

  dropGuest(gid) {
    const g = this.guests.get(gid);
    if (!g) return;
    this.guests.delete(gid);
    g.transport.closed = true;
    if (g.unsub) g.unsub();
    if (g.joined) this.game.leave(gid);
    this.fb.remove(this.fb.child(this.room, `up/${gid}`));
    this.fb.remove(this.fb.child(this.room, `down/${gid}`));
  }

  kick(g) {
    this.flush();
    this.fb.remove(this.fb.child(this.room, `guests/${g.gid}`));
  }

  queue(g, event, data) {
    if (g.transport.closed) return;
    // only the newest snapshot matters; older ones are already out of date
    if (event === 'snap') g.snap = data;
    else g.out.push([event, data]);
  }

  async receive(g, list) {
    for (const m of list.slice(0, 80)) {
      if (!Array.isArray(m)) continue;
      const [kind, id, type, payload] = m;
      if (typeof type !== 'string') continue;
      if (kind === 'h') {
        const res = await this.game.join(g.gid, payload, g.transport);
        g.joined = !!(res && res.ok);
        if (g.joined) {
          const s = this.game.players.get(g.gid);
          if (s && s.offlineEarned) {
            this.game.toast(s, `Your monsters earned ${s.offlineEarned} Money while you were away! Collect it at your base.`, 'good');
            s.offlineEarned = 0;
          }
        }
        g.out.push(['__res', { id, res }]);
        continue;
      }
      if (!g.joined || !this.game.handlers[type]) {
        if (kind === 'r') g.out.push(['__res', { id, res: { ok: false, error: 'unknown' } }]);
        continue;
      }
      if (kind === 's' && type === 'move') {
        g.move = payload; // applied on the next move tick (see applyMove)
        continue;
      }
      // anything else acts from the guest's latest position
      this.applyMove(g);
      const res = this.game.handle(g.gid, type, payload);
      if (kind === 'r') g.out.push(['__res', { id, res: res || { ok: true } }]);
    }
    if (g.out.some((m) => m[0] === '__res')) this.flushGuest(g);
  }

  // Positions arrive in batches, sometimes several at once after a network
  // hiccup. The server checks speed against the time since the last move it
  // accepted, so it gets only the newest position, at most every MOVE_MS.
  applyMove(g) {
    if (!g.move || !g.joined) return;
    const m = g.move;
    g.move = null;
    this.game.handle(g.gid, 'move', m);
  }

  flushGuest(g) {
    const msgs = g.out;
    if (g.snap) msgs.push(['snap', g.snap]);
    g.out = [];
    g.snap = null;
    if (!msgs.length || g.transport.closed) return;
    this.fb.push(this.fb.child(this.room, `down/${g.gid}`), { j: JSON.stringify(msgs) });
  }

  flush() {
    for (const g of this.guests.values()) this.flushGuest(g);
  }

  close() {
    for (const stop of this.stopTimers || []) stop();
    for (const u of this.unsubs || []) u();
    if (this.room) this.fb.remove(this.room);
  }

  link() {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', this.code);
    return u.toString();
  }
}

// ------------------------------------------------------------------ guest

export class RoomGuestNet {
  constructor(code) {
    this.code = code;
    this.remote = true;
    this.socket = null;
    this.offset = 0;
    this.rtt = 250;
    this.handlers = new Map();
    this.connected = false;
    this.pending = new Map();
    this.seq = 0;
    this.out = [];
    this.move = null;
  }

  async connect() {
    const { fb, db } = await firebase();
    this.fb = fb;
    this.db = db;
    const room = fb.ref(db, `${ROOT}/${this.code}`);
    this.room = room;
    const host = await fb.get(fb.child(room, 'host'));
    if (!host.exists()) throw new Error(`Room ${this.code} was not found. Check the code, or ask your friend to open the room again.`);
    if (host.val().v !== PROTOCOL_VERSION) throw new Error('Your friend has a different version of the game. Both of you: refresh the page.');
    this.gid = randomId('g', 12);
    const me = fb.child(room, `guests/${this.gid}`);
    await fb.onDisconnect(me).remove();
    await fb.onDisconnect(fb.child(room, `up/${this.gid}`)).remove();
    await fb.onDisconnect(fb.child(room, `down/${this.gid}`)).remove();
    // listen before announcing ourselves, so nothing is missed
    this.bytesIn = 0;
    this.unsubDown = fb.onChildAdded(fb.child(room, `down/${this.gid}`), (snap) => {
      const v = snap.val();
      this.bytesIn += v && typeof v.j === 'string' ? v.j.length : 0;
      const list = parse(v);
      fb.remove(snap.ref);
      this.receive(list);
    });
    this.unsubHost = fb.onValue(fb.child(room, 'host'), (snap) => {
      if (!snap.exists() && this.connected) {
        this.connected = false;
        this.emitLocal('roomClosed');
      }
    });
    this.unsubMe = fb.onValue(me, (snap) => {
      // the host removed us (kicked, or the room is full and closed)
      if (!snap.exists() && this.connected && this.joinedOnce) {
        this.connected = false;
        this.emitLocal('roomClosed');
      }
    });
    await fb.set(me, { at: fb.serverTimestamp() });
    this.upTimer = setInterval(() => this.flush(), UP_MS);
    this.socket = { room: this.code };
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

  receive(list) {
    for (const m of list) {
      if (!Array.isArray(m)) continue;
      const [event, data] = m;
      if (event === '__res') {
        const done = this.pending.get(data?.id);
        if (done) {
          this.pending.delete(data.id);
          done(data.res);
        }
      } else {
        this.emitLocal(event, data);
      }
    }
  }

  call(kind, type, payload, timeout) {
    return new Promise((resolve) => {
      if (!this.connected) return resolve({ ok: false, error: 'offline', message: 'Not connected.' });
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout', message: "Your friend's game did not answer in time." });
      }, timeout);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res || { ok: true });
      });
      this.out.push([kind, id, type, payload]);
      this.flush();
    });
  }

  async hello(token, name, color) {
    const t0 = Date.now();
    const res = await this.call('h', 'hello', { protocol: PROTOCOL_VERSION, token, name, color }, 20000);
    if (res && res.serverTime) {
      this.rtt = Date.now() - t0;
      this.offset = res.serverTime - (t0 + this.rtt / 2);
    }
    if (res && res.ok) this.joinedOnce = true;
    return res;
  }

  send(type, payload) {
    if (!this.connected) return;
    // positions are sent as the newest one per batch
    if (type === 'move') this.move = payload;
    else this.out.push(['s', 0, type, payload]);
  }

  request(type, payload = {}, timeout = 8000) {
    if (TRANSACTIONAL.has(type) && !payload.reqId) payload = { ...payload, reqId: randomId('r', 10) };
    return this.call('r', type, payload, timeout);
  }

  flush() {
    if (!this.connected) return;
    if (this.move) {
      this.out.push(['s', 0, 'move', this.move]);
      this.move = null;
    }
    if (!this.out.length) return;
    const j = JSON.stringify(this.out);
    this.out = [];
    this.fb.push(this.fb.child(this.room, `up/${this.gid}`), { j });
  }

  async syncClock() {
    const t0 = Date.now();
    const res = await this.request('ping', {}, 4000);
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
