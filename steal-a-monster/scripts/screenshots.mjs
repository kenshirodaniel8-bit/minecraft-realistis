// Captures the README screenshots (docs/screenshots/*.jpg).
//   node scripts/screenshots.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/network.js';
import { SPECIES_BY_ID } from '../shared/monsters.js';
import { CONFIG } from '../shared/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pw;
for (const t of [root, '/opt/node22/lib/node_modules/']) {
  try {
    pw = createRequire(path.join(t, 'x.js'))('playwright');
    break;
  } catch { /* next */ }
}
if (!pw) process.exit(2);
const out = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-shots-'));
const srv = await createGameServer({ port: 0, host: '127.0.0.1', dataDir, devCommands: true, quiet: true });
for (const e of Object.values(srv.game.events.events)) e.nextAt = Infinity;
srv.game.dayEpoch = Date.now() - CONFIG.dayLengthMs * 0.3; // late morning
const base = `http://127.0.0.1:${srv.port}`;
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const save = (page, name) => page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });

// gallery
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  await page.goto(`${base}/gallery.html`);
  await page.waitForTimeout(6000);
  // crop to the monsters (the camera looks down on the grid)
  await page.screenshot({ path: path.join(out, 'gallery.png'), clip: { x: 0, y: 190, width: 1400, height: 490 } });
  await page.goto(`${base}/gallery.html?only=chompkin,draklet,voltkit,owlium,fennix&cols=5`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(out, 'gallery-closeup.jpg'), type: 'jpeg', quality: 85, clip: { x: 0, y: 150, width: 1400, height: 520 } });
  await page.close();
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => localStorage.setItem('sam_settings', JSON.stringify({ quality: 'high', name: 'Mira', color: 0xff7ab8, volume: 0 })));
const page = await ctx.newPage();
await page.goto(base);
await page.click('#play-btn');
await page.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 120000 });
const s = [...srv.game.players.values()][0];
// a lived-in profile for the shots
srv.game.economy.credit(s, 23456, 'shots');
s.profile.base.slots = 12;
let slot = 0;
for (const [sp, lvl] of [['draklet', 3], ['mossbun', 2], ['voltkit', 3], ['puffcorn', 2], ['chompkin', 4], ['bloopfin', 2], ['owlium', 5], ['fennix', 4]]) {
  const m = { id: `mshot${sp}`, species: sp, level: lvl, slot: slot++, following: false, origin: 'recruited', obtainedAt: Date.now() };
  s.profile.monsters.push(m);
  srv.game.ledger.set(m.id, s.id, sp, lvl);
  s.profile.discoveries.species[sp] = Date.now();
}
s.profile.swords.push('flame');
s.profile.sword = 'flame';
s.profile.cosmetics.owned.push('lucky_crown');
s.profile.cosmetics.equipped = 'lucky_crown';
srv.game.refreshPerks(s);
srv.game.markProfile(s);
srv.game.bases.broadcastBase(s.baseIndex);
srv.game.broadcast('playerInfo', srv.game.playerInfo(s));
srv.game.tutorialEvent(s, 'explore');
const b = srv.game.world.bases[s.baseIndex];
// look at the base from the door
await page.evaluate(([yaw]) => { const a = window.__app; a.cam.yaw = yaw; a.cam.pitch = 0.42; a.cam.distance = 22; }, [b.yaw]);
await page.waitForTimeout(4000);
await save(page, 'base');

// out in the plains with monsters around
const gap = b.angle + Math.PI / 12;
srv.game.teleport(s, Math.cos(gap) * 120, srv.game.world.groundHeight(Math.cos(gap) * 120, Math.sin(gap) * 120), Math.sin(gap) * 120, 'shots');
await page.waitForTimeout(1500);
const ahead = (d, side = 0) => ({ x: s.pos.x + Math.cos(gap) * d - Math.sin(gap) * side, z: s.pos.z + Math.sin(gap) * d + Math.cos(gap) * side });
for (const [sp, d, side] of [['chompkin', 9, -3], ['mossbun', 14, 5], ['voltkit', 17, -7], ['bloopfin', 12, 9], ['puffcorn', 20, 2]]) {
  const p = ahead(d, side);
  srv.game.monsters.spawn(SPECIES_BY_ID[sp], 2, p.x, p.z, { region: 'plains' });
}
await page.evaluate(([yaw]) => { const a = window.__app; a.cam.yaw = yaw; a.cam.pitch = 0.25; a.cam.distance = 14; a.player.yaw = yaw + Math.PI; }, [Math.atan2(-Math.cos(gap), -Math.sin(gap))]);
await page.waitForTimeout(3500);
await save(page, 'plains');
// a fight: a Chompkin right in front, mid-swing
const foe = ahead(3.2, 0);
srv.game.monsters.spawn(SPECIES_BY_ID.chompkin, 3, foe.x, foe.z, { region: 'plains' });
await page.waitForTimeout(1500);
await page.evaluate(([yaw]) => { const a = window.__app; a.cam.yaw = yaw + 0.5; a.cam.pitch = 0.22; a.cam.distance = 9; a.player.yaw = yaw + Math.PI; }, [Math.atan2(-Math.cos(gap), -Math.sin(gap))]);
await page.evaluate(() => { const a = window.__app; a.input.setVirtual('attack', true); });
await page.waitForTimeout(1600);
await save(page, 'battle');
await page.evaluate(() => { const a = window.__app; a.input.setVirtual('attack', false); });
// LUCKY LUCKY
srv.game.events.trigger('luckyLucky');
srv.game.events.events.luckyLucky.startsAt = Date.now();
await page.waitForTimeout(5000);
await save(page, 'lucky-lucky');
// panels
await page.evaluate(() => window.__app.ui.open('inspect', { owned: 'mshotdraklet' }));
await page.waitForTimeout(2500);
await save(page, 'inspect');
await page.evaluate(() => window.__app.ui.open('map'));
await page.waitForTimeout(1500);
await save(page, 'map');
await browser.close();
await srv.close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log('saved to', out);
