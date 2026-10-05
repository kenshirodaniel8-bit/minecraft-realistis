import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server/server.js';
import { B } from '../public/js/engine/blocks.js';

let srv;
let tmpDir;
const sockets = [];

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realiscraft-'));
  srv = await createServer({ port: 0, host: '127.0.0.1', seed: 'test-seed', worldFile: path.join(tmpDir, 'world.json'), quiet: true });
});

after(async () => {
  for (const ws of sockets) ws.terminate();
  await srv.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  sockets.push(ws);
  ws.inbox = [];
  ws.waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const w = ws.waiters.findIndex((x) => x.pred(m));
    if (w >= 0) { const [x] = ws.waiters.splice(w, 1); x.resolve(m); } else ws.inbox.push(m);
  });
  return new Promise((resolve, reject) => { ws.on('open', () => resolve(ws)); ws.on('error', reject); });
}

function waitFor(ws, pred, ms = 3000) {
  const i = ws.inbox.findIndex(pred);
  if (i >= 0) return Promise.resolve(ws.inbox.splice(i, 1)[0]);
  return new Promise((resolve, reject) => {
    const entry = { pred, resolve };
    ws.waiters.push(entry);
    setTimeout(() => {
      const k = ws.waiters.indexOf(entry);
      if (k >= 0) { ws.waiters.splice(k, 1); reject(new Error('timeout waiting for message')); }
    }, ms);
  });
}

const send = (ws, o) => ws.send(JSON.stringify(o));

test('serves the game page and three.js, blocks path traversal', async () => {
  const base = `http://127.0.0.1:${srv.port}`;
  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.match(await index.text(), /RealisCraft/);
  assert.equal((await fetch(base + '/lib/three/build/three.module.js')).status, 200);
  assert.equal((await fetch(base + '/js/engine/worker.js')).status, 200);
  assert.equal((await fetch(base + '/lib/three/package.json')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(base + '/..%2fserver/server.js')).status, 404);
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(typeof status.seed, 'number');
});

test('players join, see each other, sync blocks, chat and moves', async () => {
  const a = await connect();
  send(a, { t: 'hello', v: 1, name: 'Alice', skin: 'data:image/png;base64,AAAA', slim: true });
  const wa = await waitFor(a, (m) => m.t === 'welcome');
  assert.equal(typeof wa.seed, 'number');
  assert.ok(wa.spawn && Number.isFinite(wa.spawn.y));
  assert.deepEqual(wa.players, []);

  const b = await connect();
  send(b, { t: 'hello', v: 1, name: 'Alice', skin: 'not-a-png' });
  const wb = await waitFor(b, (m) => m.t === 'welcome');
  assert.equal(wb.players.length, 1);
  assert.equal(wb.players[0].name, 'Alice');
  assert.equal(wb.players[0].slim, true);
  const join = await waitFor(a, (m) => m.t === 'join');
  assert.equal(join.player.name, 'Alice2', 'duplicate names get a suffix');
  assert.equal(join.player.skin, null, 'invalid skins are dropped');

  // Block edits near the player are broadcast to others.
  const sp = wa.spawn;
  send(a, { t: 'move', x: sp.x, y: sp.y, z: sp.z, yaw: 0, pitch: 0, f: 0, h: 1 });
  await new Promise((r) => setTimeout(r, 120));
  const bx = Math.floor(sp.x), by = Math.floor(sp.y) - 1, bz = Math.floor(sp.z);
  send(a, { t: 'set', x: bx, y: by, z: bz, id: B.GLASS });
  const set = await waitFor(b, (m) => m.t === 'set');
  assert.deepEqual([set.x, set.y, set.z, set.id], [bx, by, bz, B.GLASS]);

  // Moves are relayed.
  send(a, { t: 'move', x: sp.x + 1, y: sp.y, z: sp.z, yaw: 1, pitch: 0.2, f: 1, h: 5 });
  const moves = await waitFor(b, (m) => m.t === 'moves' && m.list.some((e) => e[0] === wa.id && Math.abs(e[1] - (sp.x + 1)) < 1e-6));
  assert.ok(moves);

  // Chat
  send(b, { t: 'chat', text: 'hi there\u0007' });
  const chat = await waitFor(a, (m) => m.t === 'chat' && m.from === 'Alice2');
  assert.equal(chat.text, 'hi there');

  // Invalid edits are ignored: bad id, out of world, too far away.
  send(a, { t: 'set', x: bx, y: by, z: bz, id: 999 });
  send(a, { t: 'set', x: bx, y: 500, z: bz, id: 1 });
  send(a, { t: 'set', x: bx + 1000, y: by, z: bz, id: 1 });
  send(a, { t: 'set', x: 1.5, y: by, z: bz, id: 1 });
  await assert.rejects(waitFor(b, (m) => m.t === 'set', 400));

  // A late joiner receives the edit list.
  const c = await connect();
  send(c, { t: 'hello', v: 1, name: 'Carol' });
  const wc = await waitFor(c, (m) => m.t === 'welcome');
  const e = wc.edits;
  let found = false;
  for (let i = 0; i < e.length; i += 4) if (e[i] === bx && e[i + 1] === by && e[i + 2] === bz && e[i + 3] === B.GLASS) found = true;
  assert.ok(found);
  assert.equal(wc.players.length, 2);

  // Leaving is announced.
  c.close();
  const leave = await waitFor(a, (m) => m.t === 'leave');
  assert.equal(leave.id, wc.id);

  // Time command
  send(a, { t: 'cmd', cmd: 'time', value: 0.75 });
  const tm = await waitFor(b, (m) => m.t === 'time');
  assert.equal(tm.time, 0.75);
});

test('rejects wrong protocol versions', async () => {
  const ws = await connect();
  send(ws, { t: 'hello', v: 999, name: 'Old' });
  const err = await waitFor(ws, (m) => m.t === 'error');
  assert.match(err.message, /reload/i);
});

test('world edits persist to disk', async () => {
  await srv.world.save();
  const file = path.join(tmpDir, 'world.json');
  srv.world.dirty = true;
  await srv.world.save();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(typeof data.seed, 'number');
  assert.ok(Array.isArray(data.edits) && data.edits.length >= 4);
});
