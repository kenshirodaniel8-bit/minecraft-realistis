// End-to-end browser test: two real browser players on one server.
//
//   npm run test:e2e                 (needs Playwright + a Chromium build)
//   E2E_SHOTS=./shots npm run test:e2e   save screenshots
//
// It starts its own server (temporary data dir, dev commands on), then:
//   Alice: joins with 1,000 Money, defeats a monster, pays to recruit it,
//          presses H and sees it placed on a pad in her base.
//   Bob:   joins, walks into Alice's unlocked base, holds E to steal the
//          monster and carries it to his own base -> ownership moves.
// Every step is checked against the client state and the server state.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/network.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  const tries = [root, '/opt/node22/lib/node_modules/', process.env.PLAYWRIGHT_PATH].filter(Boolean);
  for (const t of tries) {
    try {
      return createRequire(path.join(t, 'x.js'))('playwright');
    } catch { /* try next */ }
  }
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const { chromium } = loadPlaywright();
const shots = process.env.E2E_SHOTS || null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-e2e-'));
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};

const srv = await createGameServer({ port: 0, host: '127.0.0.1', dataDir, devCommands: true, quiet: true });
for (const e of Object.values(srv.game.events.events)) e.nextAt = Infinity;
const url = `http://127.0.0.1:${srv.port}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function player(name, color) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  await ctx.addInitScript(([n, c]) => localStorage.setItem('sam_settings', JSON.stringify({ quality: 'low', name: n, color: c, volume: 0 })), [name, color]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(url);
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 90000 });
  return page;
}

// walk around the inner ring (between the plaza and the bases) to an angle
async function ringWalk(page, fromAngle, toAngle, r = 72) {
  let d = toAngle - fromAngle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(d) / 0.3));
  for (let i = 1; i <= n; i++) {
    const a = fromAngle + (d * i) / n;
    await walkTo(page, Math.cos(a) * r, Math.sin(a) * r, 3, 20000);
  }
}

const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
const state = (page) => page.evaluate(() => {
  const a = window.__app;
  return { money: a.profile.money, monsters: a.profile.monsters.map((m) => ({ id: m.id, species: m.species, slot: m.slot })), carry: a.myCarry, base: a.myBase, pos: { ...a.player.pos }, offers: [...a.ui.offerEls.keys()], fps: a.stats?.fps };
});

// walk with the real controls (camera + forward key) inside the page
const walkTo = (page, x, z, near = 2, maxMs = 60000) => page.evaluate(([x, z, near, maxMs]) => new Promise((resolve) => {
  const a = window.__app;
  const t0 = performance.now();
  const iv = setInterval(() => {
    const p = a.player.pos;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < near || performance.now() - t0 > maxMs) {
      a.input.setVirtual('forward', false);
      a.input.down.delete('sprint');
      clearInterval(iv);
      resolve(d);
      return;
    }
    a.cam.yaw = Math.atan2(-dx, -dz);
    a.input.setVirtual('forward', true);
    a.input.down.add('sprint');
  }, 40);
}), [x, z, near, maxMs]);

// fight a monster with left-click swings until the server says it is defeated
const fight = (page, id, maxMs = 90000) => page.evaluate(([id, maxMs]) => new Promise((resolve) => {
  const a = window.__app;
  const t0 = performance.now();
  const iv = setInterval(() => {
    const m = a.monsters.get(id);
    if (!m || m.gone || m.state === 7 || performance.now() - t0 > maxMs) {
      a.input.setVirtual('attack', false);
      a.input.setVirtual('forward', false);
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
  console.log(`server on ${url}`);
  console.log('Alice joins');
  const alice = await player('Alice', 0xe84a5f);
  let A = await state(alice);
  check(A.money === 1000, `new player starts with 1,000 Money (got ${A.money})`);
  await shot(alice, '01-alice-base');

  console.log('Alice walks out and fights');
  const b = srv.game.world.bases[A.base];
  await walkTo(alice, b.outside.x, b.outside.z, 2, 20000);
  // out between two bases into the meadow
  const gap = b.angle + Math.PI / 12;
  await walkTo(alice, Math.cos(gap) * 74, Math.sin(gap) * 74, 3, 20000);
  await walkTo(alice, Math.cos(gap) * 128, Math.sin(gap) * 128, 3, 30000);
  await alice.evaluate((g) => { window.__app.player.yaw = Math.atan2(Math.cos(g), Math.sin(g)); }, gap);
  await alice.waitForTimeout(300);
  // a dev command spawns a Chompkin right in front of her (same code path as natural spawns)
  await alice.evaluate(() => window.__app.net.request('chat', { text: '/spawn chompkin' }));
  await alice.waitForTimeout(1500);
  const target = await alice.evaluate(() => {
    const a = window.__app;
    let best = null;
    for (const m of a.monsters.map.values()) if (m.species.id === 'chompkin' && m.state !== 7 && (!best || m.pos.distanceTo(a.sceneView.camera.position) < best.pos.distanceTo(a.sceneView.camera.position))) best = m;
    return best ? best.id : null;
  });
  check(target !== null, 'a Chompkin is visible on the client');
  await shot(alice, '02-alice-sees-monster');
  const result = await fight(alice, target);
  check(result === 7, `Alice defeated it with her sword (state ${result})`);
  await alice.waitForTimeout(1000);
  A = await state(alice);
  check(A.offers.includes(target), 'a recruitment card appeared');
  check(A.monsters.length === 0, 'defeat alone does not give ownership');
  await shot(alice, '03-recruit-card');

  console.log('Alice pays to recruit (R)');
  const before = A.money;
  await alice.keyboard.down('KeyR');
  await alice.waitForTimeout(250);
  await alice.keyboard.up('KeyR');
  await alice.waitForTimeout(2000);
  A = await state(alice);
  check(A.monsters.length === 1 && A.monsters[0].species === 'chompkin', 'Alice now owns the Chompkin');
  check(A.money < before, `the fee was paid (${before} -> ${A.money})`);
  const owned = A.monsters[0];

  console.log('Alice presses H and her monster moves in');
  await alice.keyboard.down('KeyH');
  await alice.waitForTimeout(250);
  await alice.keyboard.up('KeyH');
  await alice.waitForTimeout(2500);
  A = await state(alice);
  check(Math.hypot(A.pos.x - b.spawn.x, A.pos.z - b.spawn.z) < 3, 'teleported home');
  check(A.monsters[0]?.slot !== null && A.monsters[0]?.slot !== undefined, `monster placed on pad ${A.monsters[0]?.slot}`);
  await shot(alice, '04-alice-base-with-monster');

  console.log('Bob joins and steals it');
  const bob = await player('Bob', 0x3fbf5a);
  let B = await state(bob);
  check(B.money === 1000 && B.base !== A.base, `Bob has his own base (#${B.base + 1}) and 1,000 Money`);
  const bb = srv.game.world.bases[B.base];
  await walkTo(bob, bb.outside.x, bb.outside.z, 2, 20000);
  // Alice walks away so Bob's way in is clear
  await walkTo(alice, b.outside.x, b.outside.z, 2, 20000);
  await ringWalk(alice, b.angle, b.angle + 0.6, 72);
  const pad = b.slots[A.monsters[0].slot];
  await ringWalk(bob, bb.angle, b.angle, 72);
  await walkTo(bob, b.outside.x, b.outside.z, 2, 60000);
  await walkTo(bob, pad.x + 1.5, pad.z, 1.2, 30000);
  await shot(bob, '05-bob-in-alice-base');
  await bob.keyboard.down('KeyE');
  await bob.waitForTimeout(3500);
  await bob.keyboard.up('KeyE');
  await bob.waitForTimeout(800);
  B = await state(bob);
  check(B.carry >= 0, 'Bob is carrying the stolen monster');
  await shot(bob, '06-bob-carrying');
  const alerted = await alice.waitForFunction(() => window.__app.lastTheft?.stage === 'carry' && !document.getElementById('theft-alert').hidden, null, { timeout: 15000 }).then(() => true, () => false);
  check(alerted, 'Alice sees the theft alert');
  const aliceId = [...srv.game.players.values()].find((s) => s.profile.name === 'Alice').profile.id;
  check(srv.game.ledger.owner(owned.id) === aliceId, 'still owned by Alice while it is being carried');
  await walkTo(bob, b.outside.x, b.outside.z, 2, 30000);
  await ringWalk(bob, b.angle, bb.angle, 72);
  await walkTo(bob, bb.outside.x, bb.outside.z, 2, 30000);
  await walkTo(bob, bb.spawn.x, bb.spawn.z, 1.5, 90000);
  await bob.waitForTimeout(1500);
  B = await state(bob);
  A = await state(alice);
  check(B.monsters.some((m) => m.id === owned.id), 'Bob delivered it: ownership transferred');
  check(!A.monsters.some((m) => m.id === owned.id), 'Alice lost it (exactly one owner)');
  await shot(bob, '07-bob-delivered');

  console.log('Bob locks his base; Alice cannot get in');
  await bob.keyboard.down('KeyL');
  await bob.waitForTimeout(250);
  await bob.keyboard.up('KeyL');
  const locked = await alice.waitForFunction((i) => (window.__app.baseStates[i]?.lockedUntil || 0) > window.__app.serverNow(), B.base, { timeout: 15000 }).then(() => true, () => false);
  check(locked, "Alice's client shows Bob's lasers switched on");
  await ringWalk(alice, b.angle + 0.6, bb.angle, 72);
  await walkTo(alice, bb.outside.x, bb.outside.z, 2, 60000);
  await walkTo(alice, bb.spawn.x, bb.spawn.z, 1, 8000);
  const inside = await alice.evaluate((i) => {
    const a = window.__app;
    const base = a.world.bases[i];
    const dx = a.player.pos.x - base.x;
    const dz = a.player.pos.z - base.z;
    const v = dx * base.tv.x + dz * base.tv.z;
    return v < base.half - 0.5;
  }, B.base);
  check(!inside, 'the laser gate stopped Alice at the door');
  const serverInside = [...srv.game.players.values()].find((s) => s.profile.name === 'Alice').inBases.has(B.base);
  check(!serverInside, 'the server agrees: Alice is not inside');
  await shot(alice, '08-lasers-block-alice');

  console.log('LUCKY LUCKY: Alice opens a Lucky Block');
  srv.game.events.trigger('luckyLucky');
  srv.game.events.events.luckyLucky.startsAt = Date.now();
  const hasBlock = await alice.waitForFunction(() => window.__app.items.blocks.size > 0 && window.__app.events.some((e) => e.phase === 'active'), null, { timeout: 20000 }).then(() => true, () => false);
  check(hasBlock, 'the event started and Lucky Blocks appeared on the client');
  const block = await alice.evaluate(() => {
    const a = window.__app;
    let best = null;
    for (const b of a.items.blocks.values()) {
      if (a.canEnter(b.data.x, b.data.z) !== true && a.region !== 'plains') continue;
      if (Math.hypot(b.data.x, b.data.z) > 145) continue; // stay in the starter region
      const d = Math.hypot(b.data.x - a.player.pos.x, b.data.z - a.player.pos.z);
      if (!best || d < best.d) best = { id: b.data.id, x: b.data.x, z: b.data.z, d, region: b.data.region };
    }
    return best;
  });
  await shot(alice, '09-lucky-lucky');
  if (block && block.d < 400) {
    await walkTo(alice, block.x, block.z, 3, 120000);
    await alice.keyboard.down('KeyE');
    await alice.waitForTimeout(300);
    await alice.keyboard.up('KeyE');
    await alice.waitForTimeout(2000);
    const opened = [...srv.game.players.values()].find((s) => s.profile.name === 'Alice').profile.stats.luckyOpened;
    check(opened === 1, `Alice opened a Lucky Block (${opened})`);
    await shot(alice, '10-lucky-opened');
  } else {
    check(false, `no reachable Lucky Block (${JSON.stringify(block)})`);
  }
  for (const [name, p] of [['Alice', alice], ['Bob', bob]]) check(p.errors.length === 0, `${name}: no browser errors ${p.errors.slice(0, 3).join(' | ')}`);
  const perf = await alice.evaluate(() => window.__app.stats);
  console.log(`client (software rendering, 2 browsers on one CPU): fps ${perf.fps}, game logic ${perf.jsMs} ms/frame, render ${perf.renderMs} ms/frame, ${perf.calls} draw calls, ${perf.triangles} triangles`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failures ? `\nE2E FAILED (${failures})` : '\nE2E PASSED');
process.exit(failures ? 1 : 0);
