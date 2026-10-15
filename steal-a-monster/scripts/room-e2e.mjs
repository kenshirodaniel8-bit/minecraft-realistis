// End-to-end test of online rooms (Firebase Realtime Database) with the
// single-player web build: one browser hosts a room, a second browser joins
// it with the room link and plays through the host's game.
//
// Needs the Firebase Realtime Database emulator (Java):
//   curl -o db-emu.jar https://storage.googleapis.com/firebase-preview-drop/emulator/firebase-database-emulator-v4.11.2.jar
//   java -jar db-emu.jar --port 9000 &
//   node scripts/build-web.mjs && node scripts/room-e2e.mjs [emulatorHost:port=127.0.0.1:9000]
//
// It checks: the room code and link, the guest joining with its own base and
// 1,000 Money, both players seeing each other, the guest walking with the
// real controls without being corrected by the host's server, fighting,
// paying to recruit (the host's game records the guest as the owner), H home
// placing the monster on a pad, and the guest being told when the host leaves.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emulator = process.argv[2] || '127.0.0.1:9000';
const dist = path.join(root, 'dist-web');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('Build the web version first: node scripts/build-web.mjs');
  process.exit(2);
}
function loadPlaywright() {
  for (const t of [root, '/opt/node22/lib/node_modules/', process.env.PLAYWRIGHT_PATH].filter(Boolean)) {
    try {
      return createRequire(path.join(t, 'x.js'))('playwright');
    } catch { /* try next */ }
  }
  console.error('Playwright is not installed.');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// a static file server under a sub-folder, like GitHub Pages
const PREFIX = '/minecraft-realistis/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let p = u.startsWith(PREFIX) ? path.join(dist, u.slice(PREFIX.length)) : '';
  if (u.endsWith('/')) p = path.join(p, 'index.html');
  if (!p || !p.startsWith(dist) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fbConfig = { apiKey: 'demo-key', projectId: 'demo-sam', databaseURL: `http://${emulator}?ns=demo-sam`, emulator };
async function page(name, color) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  await ctx.addInitScript(([n, c, fb]) => {
    localStorage.setItem('sam_settings', JSON.stringify({ quality: 'low', name: n, color: c, volume: 0 }));
    localStorage.setItem('sam_firebase', JSON.stringify(fb));
  }, [name, color, fbConfig]);
  const p = await ctx.newPage();
  p.ctx = ctx;
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  return p;
}
const ready = (p) => p.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 120000, polling: 500 });

// walk with the real controls (camera + forward key) inside the page
const walkTo = (p, x, z, near = 2, maxMs = 60000) => p.evaluate(([x, z, near, maxMs]) => new Promise((resolve) => {
  const a = window.__app;
  const t0 = performance.now();
  a.skipRender = true;
  const iv = setInterval(() => {
    const dx = x - a.player.pos.x;
    const dz = z - a.player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < near || performance.now() - t0 > maxMs) {
      a.input.setVirtual('forward', false);
      a.skipRender = false;
      clearInterval(iv);
      resolve(d);
      return;
    }
    a.cam.yaw = Math.atan2(-dx, -dz);
    a.input.setVirtual('forward', true);
  }, 40);
}), [x, z, near, maxMs]);

const fight = (p, id, maxMs = 90000) => p.evaluate(([id, maxMs]) => new Promise((resolve) => {
  const a = window.__app;
  const t0 = performance.now();
  a.skipRender = true;
  const iv = setInterval(() => {
    const m = a.monsters.get(id);
    if (!m || m.gone || m.state === 7 || performance.now() - t0 > maxMs) {
      a.input.setVirtual('attack', false);
      a.input.setVirtual('forward', false);
      a.skipRender = false;
      clearInterval(iv);
      resolve(m ? m.state : -1);
      return;
    }
    const dx = m.pos.x - a.player.pos.x;
    const dz = m.pos.z - a.player.pos.z;
    const d = Math.hypot(dx, dz);
    a.cam.yaw = Math.atan2(-dx, -dz);
    a.input.setVirtual('forward', d > 3);
    a.input.setVirtual('attack', d < 5);
  }, 40);
}), [id, maxMs]);

try {
  console.log(`site ${base}, Firebase emulator ${emulator}`);
  console.log('Host opens a room');
  const host = await page('Hosty', 0xe84a5f);
  await host.goto(`${base}?dev`);
  check(await host.isVisible('#host-btn'), 'the title screen offers "Create room"');
  await host.click('#host-btn');
  await ready(host);
  const room = await host.evaluate(() => ({ code: window.__app.room?.code, link: window.__app.room?.link(), pill: document.getElementById('room-pill').textContent }));
  check(/^[A-Z2-9]{5}$/.test(room.code || ''), `room code ${room.code}`);
  check(room.link && room.link.includes(`room=${room.code}`), `invite link ${room.link}`);
  check(room.pill.includes(room.code), `the HUD shows the room (${room.pill.trim()})`);

  console.log('A friend opens the link and joins');
  const guest = await page('Guesty', 0x3fa6ff);
  await guest.goto(`${base}?room=${room.code}`);
  check(await guest.inputValue('#room-input') === room.code, 'the room code from the link is filled in');
  await guest.click('#join-btn');
  await ready(guest);
  await guest.evaluate(() => {
    const a = window.__app;
    a.__corrections = [];
    a.net.on('teleport', (d) => { if (d.reason) a.__corrections.push(d.reason); });
    a.net.request('tutorial', { skip: true });
  });
  const G = await guest.evaluate(() => ({ money: window.__app.profile.money, base: window.__app.myBase, mode: window.__app.mode }));
  const H = await host.evaluate(() => ({ base: window.__app.myBase }));
  check(G.mode === 'guest', 'the friend plays as a guest (no game server in their page)');
  check(G.money === 1000, `the guest starts with 1,000 Money (got ${G.money})`);
  check(G.base !== H.base, `the guest has their own base (#${G.base}, host #${H.base})`);
  await host.waitForTimeout(3000);
  const seen = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__app.players.size)));
  check(seen[0] >= 1 && seen[1] >= 1, `they see each other (host sees ${seen[0]}, guest sees ${seen[1]})`);
  const hostPill = await host.evaluate(() => document.getElementById('room-pill').textContent);
  check(/2 players/.test(hostPill), `the host's room button counts 2 players (${hostPill.trim()})`);

  console.log('The guest walks out of their tower and into the meadow');
  const world = await guest.evaluate(() => {
    const a = window.__app;
    const b = a.world.bases[a.myBase];
    return { spawn: b.spawn, outside: b.outside, angle: b.angle };
  });
  await walkTo(guest, world.outside.x, world.outside.z, 2, 30000);
  const gap = world.angle + Math.PI / 12;
  await walkTo(guest, Math.cos(gap) * 76, Math.sin(gap) * 76, 3, 30000);
  const dLeft = await walkTo(guest, Math.cos(gap) * 128, Math.sin(gap) * 128, 3, 40000);
  const srvPos = await host.evaluate(() => {
    const g = window.__app.net.game;
    const s = [...g.players.values()].find((x) => x.profile.name === 'Guesty');
    return { x: s.pos.x, z: s.pos.z };
  });
  const clientPos = await guest.evaluate(() => ({ x: window.__app.player.pos.x, z: window.__app.player.pos.z }));
  check(dLeft < 3, `the guest reached the meadow (${dLeft.toFixed(1)} m left)`);
  check(Math.hypot(srvPos.x - clientPos.x, srvPos.z - clientPos.z) < 6, `the host's server agrees where the guest is (${Math.hypot(srvPos.x - clientPos.x, srvPos.z - clientPos.z).toFixed(1)} m apart)`);
  const corr = await guest.evaluate(() => window.__app.__corrections);
  check(!corr.some((r) => r === 'speed' || r === 'wall'), `no movement corrections on the way (${corr.join(',') || 'none'})`);

  console.log('The guest fights a monster and pays to recruit it');
  const mid = await host.evaluate(() => {
    const g = window.__app.net.game;
    const s = [...g.players.values()].find((x) => x.profile.name === 'Guesty');
    const sp = g.monsters.tables.plains.find((x) => x.id === 'chompkin');
    const m = g.monsters.spawn(sp, 1, s.pos.x + Math.sin(s.yaw) * 6, s.pos.z + Math.cos(s.yaw) * 6, { region: 'plains' });
    return m.id;
  });
  await guest.waitForTimeout(2500);
  const state = await fight(guest, mid);
  check(state === 7, `the guest defeated it (state ${state})`);
  await guest.waitForTimeout(1500);
  const offers = await guest.evaluate(() => [...window.__app.ui.offerEls.keys()]);
  check(offers.includes(mid), 'a recruitment card appeared for the guest');
  const before = await guest.evaluate(() => window.__app.profile.money);
  await guest.keyboard.press('r');
  await guest.waitForFunction(() => window.__app.profile.monsters.length === 1, null, { timeout: 20000, polling: 300 }).catch(() => {});
  const after = await guest.evaluate(() => ({ money: window.__app.profile.money, monsters: window.__app.profile.monsters.map((m) => m.species), capture: window.__app.capture.list.length }));
  check(after.monsters[0] === 'chompkin', `the guest owns the Chompkin (${after.monsters.join(',')})`);
  check(after.money < before, `the fee was paid (${before} -> ${after.money})`);
  const owner = await host.evaluate(() => {
    const g = window.__app.net.game;
    const s = [...g.players.values()].find((x) => x.profile.name === 'Guesty');
    const m = s.profile.monsters[0];
    return m ? g.ledger.owner(m.id) === s.profile.id : false;
  });
  check(owner, "the host's game records the guest as the owner");

  console.log('The guest presses H; the monster moves into their base');
  await guest.keyboard.press('h');
  await guest.waitForFunction(() => window.__app.profile.monsters[0]?.slot !== null, null, { timeout: 20000, polling: 300 }).catch(() => {});
  const slot = await guest.evaluate(() => window.__app.profile.monsters[0]?.slot);
  check(slot !== null && slot !== undefined, `placed on pad ${slot}`);
  const rtt = await guest.evaluate(async () => {
    for (let i = 0; i < 3; i++) await window.__app.net.syncClock();
    return Math.round(window.__app.net.rtt);
  });
  const kbps = await guest.evaluate(async () => {
    const n = window.__app.net;
    const b0 = n.bytesIn;
    await new Promise((r) => setTimeout(r, 10000));
    return Math.round((n.bytesIn - b0) / 1024 / 10 * 10) / 10;
  });
  console.log(`  (round trip guest -> Firebase -> host -> Firebase -> guest: about ${rtt} ms on localhost; the guest downloads about ${kbps} KB/s)`);

  console.log('The host closes the game');
  await host.ctx.close();
  await guest.waitForFunction(() => !document.getElementById('disconnected').hidden, null, { timeout: 30000, polling: 500 }).catch(() => {});
  const disc = await guest.evaluate(() => ({ shown: !document.getElementById('disconnected').hidden, title: document.getElementById('disc-title').textContent }));
  check(disc.shown && /room was closed/i.test(disc.title), `the guest is told (${disc.title})`);
  check(host.errors.length === 0, `host: no browser errors ${host.errors.slice(0, 3).join(' | ')}`);
  check(guest.errors.length === 0, `guest: no browser errors ${guest.errors.slice(0, 3).join(' | ')}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\nROOM E2E FAILED (${failures})` : '\nROOM E2E PASSED');
process.exit(failures ? 1 : 0);
