// Real networking: an HTTP + Socket.IO server with real socket clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createGameServer } from '../server/network.js';
import { MemoryStore } from '../server/storage.js';
import { PROTOCOL_VERSION } from '../shared/config.js';

let srv;
const sockets = [];

before(async () => {
  srv = await createGameServer({ port: 0, host: '127.0.0.1', store: new MemoryStore(), quiet: true });
  // no surprise events during the test
  for (const e of Object.values(srv.game.events.events)) e.nextAt = Infinity;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await srv.close();
});

function connect() {
  const s = ioClient(`http://127.0.0.1:${srv.port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  s.inbox = [];
  s.onAny((e, d) => s.inbox.push([e, d]));
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function hello(s, token, name) {
  return s.timeout(5000).emitWithAck('hello', { protocol: PROTOCOL_VERSION, token, name });
}

function waitFor(s, pred, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      const hit = s.inbox.find(([e, d]) => pred(e, d));
      if (hit) return resolve(hit[1]);
      if (Date.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(check, 20);
    };
    check();
  });
}

test('the HTTP server serves the game, shared modules, three.js and the Socket.IO client', async () => {
  const base = `http://127.0.0.1:${srv.port}`;
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /STEAL A MONSTER/);
  for (const p of ['/client/main.js', '/shared/monsters.js', '/lib/three/build/three.module.js', '/lib/three/addons/geometries/RoundedBoxGeometry.js', '/socket.io/socket.io.esm.min.js', '/gallery.html', '/health']) {
    assert.equal((await fetch(base + p)).status, 200, p);
  }
  assert.equal((await fetch(`${base}/lib/three/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/../server/game.js`)).status, 404);
  assert.equal((await fetch(`${base}/shared/../server/storage.js`)).status, 404);
});

test('3, 4. two browsers connect to the same server, get different bases and see each other move', async () => {
  const a = await connect();
  const b = await connect();
  const wa = await hello(a, 'mp-token-aaaaaaaaaa', 'Ann');
  const wb = await hello(b, 'mp-token-bbbbbbbbbb', 'Ben');
  assert.equal(wa.ok, true);
  assert.equal(wb.ok, true);
  assert.equal(wa.profile.money, 1000);
  assert.equal(wb.profile.money, 1000);
  assert.notEqual(wa.baseIndex, wb.baseIndex);
  assert.notEqual(wa.pn, wb.pn);
  assert.ok(wb.players.some((p) => p.pn === wa.pn), 'Ben sees Ann in the welcome');
  await waitFor(a, (e, d) => e === 'playerJoined' && d.pn === wb.pn);
  // Ann walks; Ben sees the movement in snapshots
  const start = wa.pos;
  const target = { x: start.x + 1.5, z: start.z };
  a.emit('move', { x: target.x, y: start.y, z: target.z, yaw: 1, a: 1, tp: wa.teleportSeq });
  const snap = await waitFor(b, (e, d) => e === 'snap' && d.p.some((row) => row[0] === wa.pn && Math.abs(row[1] - target.x) < 0.01));
  const row = snap.p.find((r) => r[0] === wa.pn);
  assert.ok(Math.abs(row[3] - target.z) < 0.01);
  // both bases are broadcast to everyone
  assert.ok(wa.bases.some((x) => x.index === wa.baseIndex));
  await waitFor(a, (e, d) => e === 'base' && d.index === wb.baseIndex && d.name === 'Ben');
});

test('20. LUCKY LUCKY is synchronised between players (same phase and timestamps)', async () => {
  const a = await connect();
  const b = await connect();
  await hello(a, 'mp-token-cccccccccc', 'Cal');
  await hello(b, 'mp-token-dddddddddd', 'Dee');
  srv.game.events.trigger('luckyLucky');
  const ea = await waitFor(a, (e, d) => e === 'event' && d.some((x) => x.phase === 'announce'));
  const eb = await waitFor(b, (e, d) => e === 'event' && d.some((x) => x.phase === 'announce'));
  assert.deepEqual(ea, eb);
  assert.ok(ea[0].startsAt > Date.now() - 1000);
  // fast-forward the event start
  srv.game.events.events.luckyLucky.startsAt = Date.now();
  const aa = await waitFor(a, (e, d) => e === 'event' && d.some((x) => x.phase === 'active'), 3000);
  const ab = await waitFor(b, (e, d) => e === 'event' && d.some((x) => x.phase === 'active'), 3000);
  assert.deepEqual(aa, ab);
  await waitFor(a, (e) => e === 'luckySpawn');
  srv.game.events.events.luckyLucky.endsAt = Date.now();
  await waitFor(b, (e, d) => e === 'event' && d.every((x) => x.phase === 'idle'), 3000);
  srv.game.events.events.luckyLucky.nextAt = Infinity;
});

test('22. bad or forged socket messages are rejected (protocol, tokens, payloads)', async () => {
  const a = await connect();
  const bad = await a.timeout(5000).emitWithAck('hello', { protocol: 999, token: 'mp-token-eeeeeeeeee', name: 'Eve' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'protocol');
  const b = await connect();
  const badTok = await b.timeout(5000).emitWithAck('hello', { protocol: PROTOCOL_VERSION, token: 'x', name: 'Eve' });
  assert.equal(badTok.error, 'bad_token');
  const c = await connect();
  const w = await hello(c, 'mp-token-ffffffffff', '<script>alert(1)</script>');
  assert.equal(w.ok, true);
  assert.ok(!w.profile.name.includes('<'));
  const r = await c.timeout(5000).emitWithAck('buySword', { swordId: 'celestial', price: 0, reqId: 'hack' });
  assert.equal(r.ok, false);
  const r2 = await c.timeout(5000).emitWithAck('recruit', { monsterId: 1, reqId: 'hack2' });
  assert.equal(r2.ok, false);
  // messages before hello are ignored entirely
  const d = await connect();
  let answered = false;
  d.emit('buySword', { swordId: 'stone' }, () => { answered = true; });
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(answered, false);
});
