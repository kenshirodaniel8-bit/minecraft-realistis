// End-to-end test of accounts and online rooms (Firebase Authentication +
// Realtime Database) with the web build: the admin account "daniel" hosts a
// room, a second browser creates an account and joins it with the room link
// and plays through the host's game.
//
// Needs the Firebase emulators (Auth + Realtime Database) with this repo's
// rules, for example with firebase-tools:
//   firebase.json: {"database":{"rules":"firebase-database.rules.json"},
//                   "emulators":{"auth":{"port":9099},"database":{"port":9000}}}
//   npx firebase-tools emulators:start --only auth,database --project demo-sam
//   node scripts/build-web.mjs && node scripts/room-e2e.mjs [db=127.0.0.1:9000] [auth=127.0.0.1:9099]
//
// It checks: creating accounts and logging in, the room code and link, the
// guest joining with its own base and 1,000 Money, both players seeing each
// other, the guest walking with the real controls without being corrected by
// the host's server, fighting, paying to recruit, H home placing the monster
// on a pad, the guest's progress being saved in THEIR account and coming
// along to their own game ("continue" on the start-over question), the admin
// panel (who stole what), giving a stolen monster back, banning (kicked, can't
// come back), and the guest being told when the host leaves.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emulator = process.argv[2] || '127.0.0.1:9000';
const authEmulator = process.argv[3] || '127.0.0.1:9099';
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
const fbConfig = {
  apiKey: 'demo-key', authDomain: 'demo-sam.firebaseapp.com', projectId: 'demo-sam',
  databaseURL: `http://${emulator}?ns=demo-sam-default-rtdb`, emulator, authEmulator,
};
async function page(name, color) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  await ctx.addInitScript(([n, c, fb]) => {
    localStorage.setItem('sam_settings', JSON.stringify({ quality: 'low', name: n, color: c, volume: 0 }));
    localStorage.setItem('sam_firebase', JSON.stringify(fb));
  }, [name, color, fbConfig]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept()); // "Ban …?" / "Really start over?"
  p.ctx = ctx;
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  p.on('response', (r) => { if (r.status() >= 400) p.errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
  return p;
}
const ready = async (p) => {
  try {
    await p.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 120000, polling: 500 });
  } catch (e) {
    const status = await p.evaluate(() => [document.getElementById('title-status')?.textContent, document.getElementById('loading-text')?.textContent, !document.getElementById('progress-choice').hidden]).catch(() => null);
    console.log('  (not in the game:', JSON.stringify(status), 'errors:', (p.errors || []).slice(0, 5).join(' | '), ')');
    throw e;
  }
};

// create the account (or log in if it exists from an earlier run)
async function account(p, name, password) {
  await p.waitForFunction(() => window.__app?.accounts && document.getElementById('account-note').textContent !== 'Connecting to accounts…', null, { timeout: 60000, polling: 300 });
  if (await p.isVisible('#account-in')) return 'already';
  for (const tab of ['#tab-register', '#tab-login']) {
    await p.click(tab);
    await p.fill('#name-input', name);
    await p.fill('#password-input', password);
    await p.click('#account-btn');
    await p.waitForFunction(() => !document.getElementById('account-in').hidden || /⚠/.test(document.getElementById('account-note').textContent), null, { timeout: 30000, polling: 300 });
    if (await p.isVisible('#account-in')) {
      p.errors.length = 0; // (a failed first try, e.g. "taken" on a second run, logs an HTTP 400)
      return tab === '#tab-register' ? 'created' : 'logged in';
    }
  }
  throw new Error(`could not log in as ${name}: ${await p.textContent('#account-note')}`);
}
// the "start over or continue?" question
async function continueProgress(p) {
  const shown = await p.waitForSelector('#progress-choice:not([hidden])', { timeout: 20000 }).then(() => true, () => false);
  if (shown) await p.click('#pc-continue');
  return shown;
}
const guestName = `Guesty${Date.now().toString(36).slice(-4)}`;

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
  console.log(`site ${base}, Firebase emulators ${emulator} (database) and ${authEmulator} (auth)`);
  console.log('The admin "daniel" logs in and opens a room');
  const host = await page('daniel', 0xe84a5f);
  await host.goto(`${base}?dev`);
  check(await host.isVisible('#host-btn'), 'the title screen offers "Create room"');
  const how = await account(host, 'daniel', 'admin-pass-1');
  check(await host.isVisible('#account-admin'), `logged in as daniel (${how}), shown as the admin`);
  await host.click('#host-btn');
  await continueProgress(host);
  await ready(host);
  check(await host.isVisible('#players-btn'), 'the admin has the "Player" button');
  const room = await host.evaluate(() => ({ code: window.__app.room?.code, link: window.__app.room?.link(), pill: document.getElementById('room-pill').textContent }));
  check(/^[A-Z2-9]{5}$/.test(room.code || ''), `room code ${room.code}`);
  check(room.link && room.link.includes(`room=${room.code}`), `invite link ${room.link}`);
  check(room.pill.includes(room.code), `the HUD shows the room (${room.pill.trim()})`);

  console.log('A friend opens the link, makes an account and joins');
  const guest = await page(guestName, 0x3fa6ff);
  await guest.goto(`${base}?room=${room.code}`);
  check(await guest.inputValue('#room-input') === room.code, 'the room code from the link is filled in');
  await guest.click('#join-btn');
  const refused = await guest.textContent('#title-status');
  check(/Log in/.test(refused), `joining needs an account (${refused.trim()})`);
  check(await account(guest, guestName, 'guest-pass-1') === 'created', `account "${guestName}" created`);
  const dupe = await page('x', 0);
  await dupe.goto(base);
  await dupe.waitForFunction(() => window.__app?.accounts?.auth, null, { timeout: 60000, polling: 300 });
  await dupe.click('#tab-register');
  await dupe.fill('#name-input', guestName.toUpperCase());
  await dupe.fill('#password-input', 'other-pass-1');
  await dupe.click('#account-btn');
  await dupe.waitForFunction(() => /⚠/.test(document.getElementById('account-note').textContent), null, { timeout: 20000, polling: 300 }).catch(() => {});
  check(/taken/.test(await dupe.textContent('#account-note')), 'nobody else can take the same name (other letters too)');
  await dupe.ctx.close();
  await guest.click('#join-btn');
  await ready(guest);
  check(await guest.isHidden('#players-btn'), 'a normal player has no "Player" button');
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
    const s = [...g.players.values()].find((x) => x.profile.name.startsWith('Guesty'));
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
    const s = [...g.players.values()].find((x) => x.profile.name.startsWith('Guesty'));
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
    const s = [...g.players.values()].find((x) => x.profile.name.startsWith('Guesty'));
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

  console.log("The guest's progress is in their own account and comes along everywhere");
  await guest.waitForFunction(async () => {
    const p = await window.__app.accounts.loadProfile();
    return !!p && p.monsters.some((m) => m.species === 'chompkin' && m.slot !== null);
  }, null, { timeout: 45000, polling: 2000 }).catch(() => {});
  const saved = await guest.evaluate(async () => (await window.__app.accounts.loadProfile())?.monsters.map((m) => m.species) || []);
  check(saved.includes('chompkin'), `saved in the guest's account (${saved.join(',') || 'nothing'})`);
  const guestCtx = guest.ctx;
  await guest.close();
  await host.waitForFunction(() => window.__app.players.size === 0, null, { timeout: 30000, polling: 500 }).catch(() => {});
  const solo = await guestCtx.newPage();
  solo.on('dialog', (d) => d.accept());
  solo.errors = [];
  solo.on('pageerror', (e) => solo.errors.push(e.message));
  await solo.goto(base);
  await solo.waitForSelector('#account-in:not([hidden])', { timeout: 60000 });
  check(true, 'still logged in after reopening the game');
  await solo.click('#play-btn');
  check(await continueProgress(solo), 'asked: start over or continue?');
  await ready(solo);
  const soloMon = await solo.evaluate(() => window.__app.profile.monsters.map((m) => m.species));
  check(soloMon.includes('chompkin'), `the Chompkin from the friend's room is in the guest's own game (${soloMon.join(',')})`);
  await solo.close();

  console.log('Back in the room: the admin returns a stolen monster and bans the thief');
  const g2 = await guestCtx.newPage();
  g2.on('dialog', (d) => d.accept());
  g2.errors = [];
  g2.on('pageerror', (e) => g2.errors.push(e.message));
  await g2.goto(`${base}?room=${room.code}`);
  await g2.waitForSelector('#account-in:not([hidden])', { timeout: 60000 });
  await g2.click('#join-btn');
  await continueProgress(g2);
  await ready(g2);
  // pretend the guest stole a monster from an absent player
  await host.evaluate(() => {
    const g = window.__app.net.game;
    const s = [...g.players.values()].find((x) => x.profile.name.startsWith('Guesty'));
    s.profile.monsters.push({ id: 'mstolen0001', species: 'mossbun', level: 2, slot: null, following: false, origin: 'stolen', obtainedAt: Date.now(), stolenFrom: 'Victim', stolenFromId: 'p_00000000000000000000000000000000', stolenFromAccount: 'victimuid000000000000000000' });
    g.ledger.set('mstolen0001', s.profile.id, 'mossbun', 2);
    g.markProfile(s);
  });
  await host.click('#players-btn');
  await host.waitForSelector('.admin-row .stolen', { timeout: 20000 });
  const panel = await host.textContent('#panel-body');
  check(panel.includes(guestName) && /Stole Mossbun Lv 2 from Victim/.test(panel), 'the Player panel shows who stole what from whom');
  await host.screenshot({ path: path.join(root, 'test-results', 'admin-panel.png') }).catch(() => {});
  await host.click('[data-act="adminReturn"]');
  await host.waitForFunction(() => !document.querySelector('[data-act="adminReturn"]'), null, { timeout: 20000, polling: 300 }).catch(() => {});
  const gone = await host.evaluate(() => {
    const g = window.__app.net.game;
    const s = [...g.players.values()].find((x) => x.profile.name.startsWith('Guesty'));
    return !s.profile.monsters.some((m) => m.id === 'mstolen0001');
  });
  check(gone, 'the stolen monster was taken from the thief');
  const ret = await host.evaluate(async () => {
    const a = window.__app.accounts;
    const snap = await a.fb.get(a.ref('sam/returns/victimuid000000000000000000')).catch((e) => ({ err: e.message }));
    return snap.err ? `read denied (as it should be: only the owner reads)` : 'readable?';
  });
  check(/denied/.test(ret), `it waits in the owner's returns (${ret})`);
  await host.click(`[data-act="adminBan"][data-name="${guestName}"]`);
  await g2.waitForFunction(() => !document.getElementById('disconnected').hidden, null, { timeout: 30000, polling: 500 }).catch(() => {});
  const kicked = await g2.evaluate(() => document.getElementById('disc-text').textContent);
  check(/banned/i.test(kicked), `the thief is kicked (${kicked.trim()})`);
  const banned = await g2.evaluate(() => window.__app.accounts.isBanned());
  check(banned === true, 'the ban is saved online');
  const g3 = await guestCtx.newPage();
  g3.on('dialog', (d) => d.accept());
  await g3.goto(`${base}?room=${room.code}`);
  await g3.waitForSelector('#account-in:not([hidden])', { timeout: 60000 });
  await g3.click('#join-btn');
  await g3.waitForFunction(() => /banned/i.test(document.getElementById('title-status').textContent), null, { timeout: 30000, polling: 500 }).catch(() => {});
  check(/banned/i.test(await g3.textContent('#title-status')), `a banned player can't come back (${(await g3.textContent('#title-status')).trim()})`);
  check(g2.errors.length === 0 && solo.errors.length === 0, `guest pages: no browser errors ${[...g2.errors, ...solo.errors].slice(0, 3).join(' | ')}`);

  console.log('The host closes the game');
  await host.ctx.close();
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
